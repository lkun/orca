/** Only positive host evidence proves slot exit. Unanswered probes stay unverifiable and never authorize starting a second slot. */
import type { ServeReadiness } from '../server/serve-readiness'
import type { OCCdActivationExpectation } from '../managed-server/activation/occd-activation-gate'
import { OCCD_INSTALL_MODEL } from '../managed-server/install/remote-install-model'
import { computeRemoteInstallDir } from '../managed-server/install/remote-versioned-install'
import { readRemoteOCCdBuildHash } from '../managed-server/install/occd-remote-build-hash'
import {
  launchOCCdSlotAndAwaitReadiness,
  OCCdActiveReadinessError,
  probeActiveOCCdReadiness
} from './occd-active-readiness'
import {
  occdLivenessProbeCommand,
  occdLivenessProvenExited,
  parseOCCdLiveness,
  type OCCdLiveness
} from '../managed-server/install/occd-remote-launch'
import {
  parseOCCdStopOutcome,
  stopOCCdCommand,
  type OCCdStopOutcome
} from '../managed-server/install/occd-remote-process-control'
import {
  execOCCdRemote,
  type OCCdRemoteExecTarget
} from '../managed-server/install/occd-remote-runtime-control'
import { occdActivationTransactionRoot } from '../managed-server/activation/occd-activation-transaction'
import {
  initialOCCdActivationAdmissionCommand,
  parseInitialOCCdActivationAdmission
} from './occd-initial-activation-admission'

export const OCCD_SLOT_STOP_WAIT_SECONDS = 20

export type OCCdSlotOptions = OCCdRemoteExecTarget & {
  remoteHome: string
  /** Host Node for legacy slots only; a slot's own runtime marker wins. */
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  readinessTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type OCCdSlotIdentity = { version: string; remoteDir: string; buildHash: string }

function expectation(identity: OCCdSlotIdentity): OCCdActivationExpectation {
  return { buildHash: identity.buildHash, fullVersion: identity.version }
}

export function occdSlotDir(options: OCCdSlotOptions, version: string): string {
  return computeRemoteInstallDir(OCCD_INSTALL_MODEL, options.remoteHome, version)
}

/** Hash installed bytes so readiness must prove the same build. */
export async function resolveOCCdSlotIdentity(
  options: OCCdSlotOptions,
  version: string
): Promise<OCCdSlotIdentity> {
  const remoteDir = occdSlotDir(options, version)
  return { version, remoteDir, buildHash: await readRemoteOCCdBuildHash(options, remoteDir) }
}

export function launchOCCdSlot(
  options: OCCdSlotOptions,
  identity: OCCdSlotIdentity
): Promise<ServeReadiness> {
  return launchOCCdSlotAndAwaitReadiness(
    options,
    {
      remoteInstallDir: identity.remoteDir,
      nodePath: options.nodePath,
      fullVersion: identity.version,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      // Every SSH launch is client-managed, so every one may idle out and be woken on connect.
      activationRoot: occdActivationTransactionRoot(options.host, options.remoteHome)
    },
    expectation(identity)
  )
}

/** Proves the slot serves, starting it only on proven exit. */
export async function ensureOCCdSlotServing(
  options: OCCdSlotOptions,
  identity: OCCdSlotIdentity
): Promise<ServeReadiness> {
  const liveness = parseOCCdLiveness(
    await execOCCdRemote(options, occdLivenessProbeCommand(options.host, identity.remoteDir))
  )
  if (liveness === 'LIVE') {
    return probeActiveOCCdReadiness(
      { ...options, remoteInstallDir: identity.remoteDir },
      expectation(identity)
    )
  }
  if (!occdLivenessProvenExited(liveness)) {
    throw new OCCdActiveReadinessError(
      'unverifiable',
      `occd ${identity.version} process state is unverifiable.`
    )
  }
  return launchOCCdSlot(options, identity)
}

/** `justLaunched` only for a slot this run started; otherwise the readiness PID must agree. */
export async function stopOCCdSlot(
  options: OCCdSlotOptions,
  remoteDir: string,
  justLaunched: boolean
): Promise<OCCdStopOutcome> {
  return parseOCCdStopOutcome(
    await execOCCdRemote(
      options,
      stopOCCdCommand(
        options.host,
        remoteDir,
        justLaunched
          ? { waitSeconds: OCCD_SLOT_STOP_WAIT_SECONDS, justLaunched: true }
          : { waitSeconds: OCCD_SLOT_STOP_WAIT_SECONDS, nodePath: options.nodePath }
      )
    )
  )
}

type OCCdSlotQuiescence = 'exited' | 'other-slot-serving'

/** Prove candidate exit before replacing state and rule out another running slot, unless it already serves. Missing PID files prove nothing: SSH may drop after nohup but before $! is recorded, so inspect data-root ownership. */
export async function quiesceInterruptedOCCdSlot(
  options: OCCdSlotOptions,
  /** `null` when nothing was launched, so only `otherSlot` needs ruling out. */
  version: string | null,
  otherSlot: OCCdSlotIdentity | null
): Promise<OCCdSlotQuiescence> {
  const remoteDir = version === null ? null : occdSlotDir(options, version)
  const stopped =
    remoteDir === null ? 'already-exited' : await stopOCCdSlot(options, remoteDir, false)
  let exited = stopped === 'stopped' || stopped === 'already-exited'
  if ((stopped === 'unknown' || stopped === 'unconfirmed') && remoteDir !== null) {
    // No verified answer, e.g. the slot died before readiness; liveness decides.
    exited = occdLivenessProvenExited(await slotLiveness(options, remoteDir))
  }
  if (otherSlot) {
    const other = await slotLiveness(options, otherSlot.remoteDir)
    if (other === 'LIVE' && (exited || stopped === 'no-pid')) {
      // The serving slot holds the instance lock, so a PID-less launch cannot own the state.
      await probeActiveOCCdReadiness(
        { ...options, remoteInstallDir: otherSlot.remoteDir },
        expectation(otherSlot)
      )
      return 'other-slot-serving'
    }
    if (!occdLivenessProvenExited(other)) {
      throw new OCCdActiveReadinessError(
        'unverifiable',
        `occd ${version ?? 'candidate'} (${stopped}) and ${otherSlot.version} (${other}) cannot both be ` +
          'ruled out as owners of the shared state; it was not replaced.'
      )
    }
  }
  if (!exited && stopped === 'no-pid' && remoteDir !== null) {
    const admission = parseInitialOCCdActivationAdmission(
      await execOCCdRemote(
        options,
        initialOCCdActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    exited = admission.decision === 'proceed'
  }
  if (!exited) {
    throw new OCCdActiveReadinessError(
      'unverifiable',
      `occd ${version ?? 'candidate'} could not be confirmed stopped (${stopped}); replacing its state would be unsafe.`
    )
  }
  return 'exited'
}

export async function slotLiveness(
  options: OCCdSlotOptions,
  remoteDir: string
): Promise<OCCdLiveness> {
  return parseOCCdLiveness(
    await execOCCdRemote(options, occdLivenessProbeCommand(options.host, remoteDir))
  )
}
