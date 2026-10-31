/** Activate under a durable host fence/journal only after candidate readiness. Recover the incumbent only with safe profile state; retain changed state/snapshot for explicit recovery. */
import { logOCCdActivationOutcome } from '../managed-server/activation/occd-activation-outcome-log'
import { join } from 'node:path'
import type { OCCdHostTransport } from './occd-host-transport'
import type { OCCdUpdateForce } from './occd-update-plan'
import { OCCD_INSTALL_MODEL } from '../managed-server/install/remote-install-model'
import {
  computeRemoteInstallDir,
  readLocalFullVersion
} from '../managed-server/install/remote-versioned-install'
import { readOCCdActivationRecord } from '../managed-server/activation/occd-activation-record-store'
import type { OCCdActivationRecord } from '../managed-server/activation/occd-activation-record'
import type { OCCdActivationVerdict } from '../managed-server/activation/occd-activation-gate'
import type { OCCdTerminalCensus } from '../../shared/occd-terminal-census'
import type { RemoteHostPlatform } from './ssh-remote-platform'
import { installOCCdBundle } from '../managed-server/install/occd-remote-install'
import { getAppEnvironment } from '../../shared/app-environment'
import type { NodeRuntimeTarget } from '../../shared/node-runtime-pin'
import { OCCD_STARTUP_READINESS_TIMEOUT_MS } from '../../shared/occd-profile-preflight'
import { materializeOCCdArtifact } from '../occd/occd-artifact-materializer'
import { readOCCdBundleTarget } from './occd-deployment-target'
import { resolveOCCdRuntimeTarget } from '../managed-server/lifecycle/occd-runtime-target'
import {
  occdNodeRuntimeInstallOptions,
  type NodeRuntimeDownloadBudget
} from './occd-node-runtime-install-options'
import {
  occdActivationFenceExists,
  resolveOCCdActivationReadinessTimeout,
  withOCCdActivationLock
} from '../managed-server/activation/occd-activation-lock'
import { activateInstalledOCCd } from './occd-installed-activation'
import { occdActivationFenceRefusal } from '../managed-server/activation/occd-activation-fence-hold'

export type OCCdDeployOptions = {
  conn: OCCdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  /** An already assembled bundle; otherwise materialize the packaged template for this host. */
  localOCCdDir?: string
  /** The bundle's runtime target; read from `localOCCdDir` or probed when absent. */
  target?: NodeRuntimeTarget
  /** Where the pinned runtime archive is cached; defaults beside the occd artifact cache. */
  runtimeCacheRoot?: string
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  /** Caller supplies a protocol-aware census; unanswered host evidence must never become zero live terminals. */
  census: OCCdTerminalCensus
  /** Bind census to its incumbent record; a changed locked record makes earlier counts unverifiable. */
  censusRecord?: OCCdActivationRecord
  /** WSL only: the record and fence this connect read moments ago; skips the same pre-upload reads. */
  preRead?: { record: OCCdActivationRecord; fenceOpen: boolean }
  /** WSL only: a same-version deploy skips its fence; the caller's wake re-checks under its own. */
  sameVersionFencedByCaller?: boolean
  /** Recount under fence just before stopping the same incumbent; uploads may outdate initial counts and failures stay unverifiable. */
  recountCensus: () => Promise<OCCdTerminalCensus>
  /** Best-effort reopen when incumbent keeps serving; admission also expires server-side. */
  releaseIncumbentAdmission: () => Promise<void>
  force?: OCCdUpdateForce
  /** The OCC app version activating, recorded so an older client never downgrades the host. */
  appVersion?: string
  /** Reapply version policy under lock because peer activation/stop may land during upload. */
  admitRecord?: (record: OCCdActivationRecord, candidateVersion: string) => string | null
  readinessTimeoutMs?: number
  /** WSL only; SSH hosts always re-hash the runtime (see `installOCCdBundle`). */
  recordedNodeRuntimeProbe?: boolean
  /** WSL only: bounded Node runtime downloads; SSH keeps the default timing. */
  nodeRuntimeDownload?: NodeRuntimeDownloadBudget
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type OCCdDeployResult =
  | { outcome: 'installed-and-activated'; fullVersion: string; verdict: OCCdActivationVerdict }
  | { outcome: 'already-active'; fullVersion: string }
  | { outcome: 'installed-not-activated'; fullVersion: string; code: string; reason: string }

export async function deployOCCd(
  input: OCCdDeployOptions,
  retryClearedFence = true
): Promise<OCCdDeployResult> {
  const target =
    input.target ??
    (input.localOCCdDir
      ? readOCCdBundleTarget(input.localOCCdDir)
      : await resolveOCCdRuntimeTarget(input))
  const runtimeCacheRoot =
    input.runtimeCacheRoot ?? join(getAppEnvironment().getPath('userData'), 'occd-artifacts')
  const options = {
    ...input,
    target,
    readinessTimeoutMs: resolveOCCdActivationReadinessTimeout(
      input.readinessTimeoutMs,
      OCCD_STARTUP_READINESS_TIMEOUT_MS
    ),
    ...occdNodeRuntimeInstallOptions(target, runtimeCacheRoot, input),
    localOCCdDir:
      input.localOCCdDir ?? (await materializeOCCdArtifact(target, { signal: input.signal }))
  }
  const fullVersion = readLocalFullVersion(options.localOCCdDir)
  const remoteDir = computeRemoteInstallDir(OCCD_INSTALL_MODEL, options.remoteHome, fullVersion)
  const held = async (): Promise<OCCdDeployResult> => {
    const { cleared, ...refusal } = await occdActivationFenceRefusal(options, 'update')
    // Retry one cleared abandoned fence; repeated abandonment must surface to the caller.
    if (cleared && retryClearedFence) {
      return deployOCCd(
        {
          ...input,
          preRead: undefined,
          sameVersionFencedByCaller: undefined,
          target,
          localOCCdDir: options.localOCCdDir
        },
        false
      )
    }
    return { outcome: 'installed-not-activated', fullVersion, ...refusal }
  }
  // Refuse before upload, then re-read both admission inputs under fence.
  const preUploadRecord = options.preRead?.record ?? (await readOCCdActivationRecord(options))
  const censusRecord = options.censusRecord ?? preUploadRecord
  // An unanswered probe only skips this shortcut; lock acquisition still arbitrates.
  if (
    !options.preRead?.fenceOpen &&
    (await occdActivationFenceExists(options).catch(() => false))
  ) {
    return held()
  }

  await installOCCdBundle(options, fullVersion, remoteDir)
  if (options.sameVersionFencedByCaller && preUploadRecord.active === fullVersion) {
    return { outcome: 'already-active', fullVersion }
  }

  return logOCCdActivationOutcome(
    `update to ${fullVersion}`,
    () =>
      withOCCdActivationLock(
        options,
        (lock) =>
          activateInstalledOCCd({ ...options, censusRecord }, fullVersion, remoteDir, lock),
        held
      ),
    ['installed-and-activated', 'already-active']
  )
}
