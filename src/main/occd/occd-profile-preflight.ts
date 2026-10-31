import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preflightProfileStateRuntime } from '../persistence/profile-state/profile-state-runtime-preflight'
import {
  OCCD_STARTUP_PREFLIGHT_FLAG,
  OCCD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseOCCdProfilePreflight,
  occdProfilePreflightResponseSchema,
  type OCCdProfilePreflightResponse
} from '../../shared/occd-profile-preflight'
import { readOCCdArtifactIdentity } from './occd-artifact-identity'
import { OCCD_EXIT_CONFIGURATION } from './occd-configuration-exit'
import { OCCD_SERVER_ENTRY_FILENAME, OCCD_VERSION_FILENAME } from '../../shared/occd-artifacts'
import { OCCD_NODE_RUNTIME_IDENTITY } from '../../shared/occd-node-runtime-identity'
import { runProcess } from '@occ/process-host'
import { preflightOCCdNativeRuntime } from './occd-runtime-native-preflight'
import { occdCompileCacheEnv } from './occd-compile-cache'
import {
  consumeOCCdStartupQualification,
  discardOCCdStartupQualification,
  isQualifiableOCCdSlot,
  occdStartupQualificationKey,
  recordOCCdStartupQualification
} from './occd-startup-qualification'
import {
  isRunningAsBundledOCCdRuntime,
  OCCdBundledRuntimeError,
  resolveBundledOCCdSlot
} from './occd-bundled-runtime'

let pendingQualification: { directory: string; key: string } | null = null
// The last marker write; recording fails open, so it never rejects.
let markerRecording: Promise<void> = Promise.resolve()

/** Qualify packaged startup before touching profile indexes, data-root locks or imports. */
export async function preflightBundledOCCdStartup(): Promise<boolean> {
  const directory = resolveBundledOCCdSlot()
  if (!isRunningAsBundledOCCdRuntime(directory)) {
    return false
  }
  const identity = await readInstalledVersion(directory)
  // Windows' child also proves the process identity table, which depends on host services.
  const key =
    process.platform === 'win32' || !isQualifiableOCCdSlot(directory)
      ? null
      : await occdStartupQualificationKey(directory, identity).catch(() => null)
  if (key && (await consumeOCCdStartupQualification(directory, key))) {
    pendingQualification = { directory, key }
    return true
  }
  try {
    await runStartupPreflightChild(directory, identity)
  } catch (error) {
    if (key) {
      await discardOCCdStartupQualification(directory)
    }
    throw error
  }
  pendingQualification = key ? { directory, key } : null
  return false
}

/** node-pty failed to load at spawn: the next launch must re-probe and report why. */
export async function discardBundledOCCdStartupQualification(): Promise<void> {
  pendingQualification = null
  // A record still renaming its marker into place would recreate it after an earlier unlink.
  await markerRecording
  const directory = resolveBundledOCCdSlot()
  if (process.platform !== 'win32' && isQualifiableOCCdSlot(directory)) {
    await discardOCCdStartupQualification(directory)
  }
}

/** A launch whose node-pty probe did not pass must not let the next one skip either probe. */
export function forgetBundledOCCdStartupQualification(): void {
  pendingQualification = null
}

async function runStartupPreflightChild(directory: string, identity: string): Promise<void> {
  const nonce = randomUUID()
  // Keep disposable SQLite ownership and native state out of the serving process.
  const result = await runProcess({
    program: process.execPath,
    args: [join(directory, OCCD_SERVER_ENTRY_FILENAME), OCCD_STARTUP_PREFLIGHT_FLAG, nonce],
    // Reuse the serving runtime code cache for this identical bundle.
    env: { ...process.env, OCC_BACKGROUND_LAUNCH: '1', ...occdCompileCacheEnv(directory) },
    timeoutMs: OCCD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    maxOutputBytes: 64 * 1024,
    terminationBarrier: true
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    const Failure = result.code === OCCD_EXIT_CONFIGURATION ? OCCdBundledRuntimeError : Error
    throw new Failure(`The bundled OCC runtime failed readiness: ${result.stderr}`)
  }
  try {
    parseOCCdProfilePreflight(result.stdout, nonce, OCCD_NODE_RUNTIME_IDENTITY, identity)
  } catch (cause) {
    throw new OCCdBundledRuntimeError('The bundled runtime returned invalid readiness identity', {
      cause
    })
  }
}

/** Call once readiness is published: only a launch that got there lets the next one skip. */
export async function confirmBundledOCCdStartupQualified(): Promise<void> {
  const qualified = pendingQualification
  pendingQualification = null
  if (qualified) {
    markerRecording = recordOCCdStartupQualification(qualified.directory, qualified.key)
    await markerRecording
  }
}

export async function runOCCdProfilePreflight(
  nonce: string | undefined,
  options: { nativeFeatures?: boolean; servedUserDataPath?: string } = {}
): Promise<void> {
  const checkedNonce = z.string().uuid().parse(nonce)
  const directory = resolveBundledOCCdSlot()
  let artifactVersion: string
  try {
    artifactVersion = await readOCCdArtifactIdentity(directory)
  } catch (cause) {
    throw new OCCdBundledRuntimeError('The bundled OCC artifacts are incomplete or altered', {
      cause
    })
  }
  const result = await preflightProfileStateRuntime()
  // Host Node rollback launchers do not serve the bundled slot.
  if (isRunningAsBundledOCCdRuntime(directory)) {
    await preflightOCCdNativeRuntime(options)
  }
  const response: OCCdProfilePreflightResponse = {
    type: 'occ_profile_state_ready',
    nonce: checkedNonce,
    runtime: 'node',
    runtimeVersion: process.versions.node,
    artifactVersion,
    ...result,
    ...(options.servedUserDataPath === undefined
      ? {}
      : { liveDaemonProtocols: await readServedDaemonProtocols(options.servedUserDataPath) })
  }
  console.log(JSON.stringify(response))
}

/** The served data root, never this probe's own, decides which daemons a restart must reach. */
async function readServedDaemonProtocols(servedUserDataPath: string): Promise<number[] | null> {
  // A failed probe leaves the crossing unverifiable; it must not fail the candidate itself.
  try {
    // Import lazily: startup preflight loads this module and needs no daemon code.
    const [{ listLiveDaemonProtocols }, { daemonRuntimeDirFor }, protocol] = await Promise.all([
      import('../daemon/daemon-generation-liveness'),
      import('../daemon/daemon-runtime-dir'),
      import('../daemon/daemon-protocol-version')
    ])
    return await listLiveDaemonProtocols(daemonRuntimeDirFor(servedUserDataPath), [
      protocol.PROTOCOL_VERSION,
      ...protocol.PREVIOUS_DAEMON_PROTOCOL_VERSIONS
    ])
  } catch {
    return null
  }
}

async function readInstalledVersion(directory: string): Promise<string> {
  try {
    return occdProfilePreflightResponseSchema.shape.artifactVersion.parse(
      (await readFile(join(directory, OCCD_VERSION_FILENAME), 'utf8')).trim()
    )
  } catch (cause) {
    throw new OCCdBundledRuntimeError(
      'The installed OCC artifact version is missing or invalid',
      {
        cause
      }
    )
  }
}
