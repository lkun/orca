/** D1/D2b/D8 reuse SSH installation, activation journals/fences and admission over wsl.exe. C5 pairs through the reported loopback port. */
import { getAppEnvironment } from '../../../shared/app-environment'
import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import { OCCD_MANAGED_REMOTE_PORT } from '../../../shared/occd-managed-runtime'
import type { ServeReadiness } from '../../server/serve-readiness'
import type { WslHostDeferredUpdate } from '../../../shared/wsl-host-types'
import { recoverInterruptedOCCdActivation } from '../../managed-server/activation/occd-activation-recovery'
import { readOCCdActivationRecord } from '../../managed-server/activation/occd-activation-record-store'
import { materializeOCCdArtifact } from '../../occd/occd-artifact-materializer'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import { OCCD_ACTIVATION_POLICY_REFUSED_CODE } from '../../ssh/occd-installed-activation'
import { occdBoundPort } from '../../managed-server/lifecycle/occd-managed-bound-port'
import {
  isForceableOCCdDeferral,
  managedOCCdDeployPolicy,
  managedOCCdSlot
} from '../../managed-server/lifecycle/occd-managed-runtime-context'
import { isWaitingOCCdUpdateDeferral } from '../../managed-server/lifecycle/occd-managed-auto-update'
import { clearOCCdUpdateFailedThisLaunch } from '../../managed-server/lifecycle/occd-managed-update-failure-memory'
import type { OCCdUpdateIntent } from '../../managed-server/lifecycle/occd-managed-update-decision'
import type { OCCdActivationRecord } from '../../managed-server/activation/occd-activation-record'
import { errorMessage } from '../../../shared/error-message'
import { pruneWslOCCdVersionsUntilClean } from './wsl-occd-version-gc-memo'
import { pruneSupersededOCCdCandidates } from '../../managed-server/lifecycle/occd-managed-version-gc'
import { wakeAlreadyActiveOCCd } from '../../ssh/occd-already-active-wake'
import { OCCdActiveReadinessError } from '../../ssh/occd-active-readiness'
import { WslDistroNotRunningError } from './wsl-occd-connection-errors'
import { deployOCCd, type OCCdDeployOptions } from '../../ssh/occd-remote-deploy'
import { isWslMoveUnderwayOnHost } from '../../persistence/moving-wsl-projects/wsl-move-running-moves'
import { readLocalFullVersion } from '../../managed-server/install/remote-versioned-install'
import { createWslDistroHolder } from '../discovery/wsl-distro-holder'
import type { WslDistroHolder } from '../discovery/wsl-distro-holder-types'
import { wslDistroHolderKey } from '../discovery/wsl-distro-holder-record'
import { readWslDistroRegistryIdShared } from '../discovery/wsl-distro-registry-id'
import type { WslOCCdHostTarget } from './wsl-occd-host-target'
import { createWslOCCdHostTransport, type WslOCCdHostTransport } from './wsl-occd-host-transport'
import { holdWslDistroWithContext } from './wsl-occd-held-context'
import { deployWslOCCdWithOneFence } from './wsl-occd-one-fence-deploy'
import { removeFailedFreshWslOCCdInstall } from './wsl-occd-failed-install-removal'
import { probeWslActiveOCCd, readWslOCCdPid } from './wsl-occd-active-probe'
import { wslOCCdConnectStateHints } from './wsl-occd-connect-state-snapshot'
import { readWslOCCdIncumbent, type WslOCCdIncumbent } from './wsl-occd-incumbent'
import { adoptUnrecordedWslOCCd } from './wsl-occd-instance-adoption'
import {
  admitWslOCCdLaunch,
  readRestoredWslOCCdRecord,
  recordWslOCCdUpdateFailure,
  wslOCCdDeferralCode,
  wslOCCdDeferralFailure
} from './wsl-occd-update-admission'
import { withOwnBuildLaunchEnv } from './wsl-occd-own-build-launch-env'
import { WSL_NODE_RUNTIME_DOWNLOAD_BUDGET } from '../execution/wsl-node-runtime-download-budget'

/** An update this app carries that the host may not take yet; the incumbent keeps serving. */
export type WslOCCdDeferredUpdate = WslHostDeferredUpdate

export type WslOCCdLaunch =
  | {
      outcome: 'ready'
      distro: string
      /** The Lxss registration GUID for the deployment record's `distroId`; null if unreadable. */
      distroId: string | null
      /** The loopback port occd bound inside the distro (another one when the preferred was taken). */
      port: number
      fullVersion: string
      pid: number | null
      readiness: ServeReadiness
      holder: 'adopted' | 'spawned' | 'unverifiable'
      /** An occd the record did not name (e.g. left by a failed Remove), now recorded. */
      adoptedInstance?: { version: string; pid: number }
      /** Set when `fullVersion` is the incumbent because the update must wait. */
      deferredUpdate?: WslOCCdDeferredUpdate
    }
  | ({ outcome: 'deferred'; distro: string } & WslOCCdDeferredUpdate)

export type WslOCCdDeployOptions = {
  /** The WSL environment's id; keys host-scoped state (wake dedupe). Defaults per distro. */
  environmentId?: string
  label?: string
  /** Defaults to a connect. */
  intent?: OCCdUpdateIntent
  signal?: AbortSignal
  /** Defaults to one created over `userData`; the app should pass its shared instance. */
  holder?: WslDistroHolder
  createTransport?: (target: WslOCCdHostTarget) => OCCdHostTransport & { dispose?(): void }
  readRegistryId?: (distro: string) => Promise<string | null>
  readIncumbent?: typeof readWslOCCdIncumbent
  /** This desktop's enrolled pairing, which the incumbent's terminal count authenticates with. */
  pairedOffer?: PairingOffer | null
  /** The occd template to deploy from; defaults to the packaged one (the C10 lane swaps it). */
  templateDir?: string
  /** A no-boot connect's running check (E9), re-read before any further wake. */
  requireRunning?: () => Promise<boolean>
}

/** Until the persisted deployment record (C7) assigns one, the environment is keyed per distro. */
export function defaultWslOCCdEnvironmentId(distro: string): string {
  return `wsl:${wslDistroHolderKey(distro)}`
}

export async function deployAndLaunchWslOCCd(
  distro: string,
  options: WslOCCdDeployOptions = {}
): Promise<WslOCCdLaunch> {
  const name = distro.trim()
  if (!name) {
    throw new Error('A WSL distro name is required')
  }
  const target: WslOCCdHostTarget = {
    kind: 'wsl',
    id: options.environmentId ?? defaultWslOCCdEnvironmentId(name),
    distro: name,
    label: options.label ?? name
  }
  const conn = (options.createTransport ?? defaultTransport)(target)
  try {
    return await launchOverTransport(name, target, conn, options)
  } finally {
    conn.dispose?.()
  }
}

async function launchOverTransport(
  name: string,
  target: WslOCCdHostTarget,
  transport: OCCdHostTransport,
  options: WslOCCdDeployOptions
): Promise<WslOCCdLaunch> {
  const { signal } = options
  let ownBuildVersion: string | null = null
  // Set by the serving probe; readyLaunch reads the pid itself for any other version.
  let probed: { fullVersion: string; pid: number | null } | null = null
  const conn = withOwnBuildLaunchEnv(transport, () => ownBuildVersion)
  // Acquire a holder before launch or WSL can idle-stop occd's distro.
  const holder = options.holder ?? createWslDistroHolder({ userDataPath: userDataPath() })
  // Read GUID alongside deploy; failure leaves the record without one.
  const distroId = (options.readRegistryId ?? readWslDistroRegistryIdShared)(name).catch(() => null)
  const first = await holdWslDistroWithContext(name, target, conn, holder, signal)
  const { held, connectState } = first
  let context = first.context
  const hints = wslOCCdConnectStateHints(connectState, context.activationRecord)
  const slot = managedOCCdSlot(context, OCCD_MANAGED_REMOTE_PORT, signal)
  const recovery = await recoverInterruptedOCCdActivation(slot, connectState ?? undefined)
  if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
    throw new Error(recovery.reason)
  }
  if (recovery.outcome === 'recovered') {
    context = { ...context, activationRecord: await readOCCdActivationRecord(slot) }
  }
  // Adopt unrecorded occd before deploy/wake or its instance lock blocks launch.
  const adoption = await adoptUnrecordedWslOCCd(
    slot,
    context.activationRecord,
    undefined,
    hints.instanceLock(context.activationRecord)
  )
  if (adoption.outcome === 'adopted') {
    context = { ...context, activationRecord: adoption.record }
  }
  const localOCCdDir = await materializeOCCdArtifact(context.serverTarget, {
    signal,
    trustVerificationRecord: true,
    ...(options.templateDir ? { templateDir: options.templateDir } : {})
  })
  const appVersion = getAppEnvironment().getVersion()
  const candidateVersion = readLocalFullVersion(localOCCdDir)
  ownBuildVersion = candidateVersion
  const failureHost = { kind: 'wsl', id: target.id } as const
  const intent = options.intent ?? 'connect'
  const admit = (record: OCCdActivationRecord, admitIntent: OCCdUpdateIntent) =>
    admitWslOCCdLaunch(
      {
        slot,
        record,
        candidateVersion,
        appVersion,
        host: failureHost,
        intent: admitIntent,
        moveRunning: isWslMoveUnderwayOnHost(userDataPath(), name)
      },
      name,
      readyLaunch
    )
  const admitted = await admit(context.activationRecord, intent)
  if ('outcome' in admitted) {
    return admitted
  }
  context = { ...context, activationRecord: admitted }
  const incumbentVersion = context.activationRecord.active
  // Only version changes need incumbent census; same-version connects deploy as no-ops.
  const incumbent: WslOCCdIncumbent | null =
    incumbentVersion && incumbentVersion !== candidateVersion
      ? await (options.readIncumbent ?? readWslOCCdIncumbent)({
          context,
          slot,
          paired: options.pairedOffer ?? null
        })
      : null
  const deployOnce = (extra: Partial<OCCdDeployOptions>) =>
    deployOCCd({
      ...slot,
      conn,
      localOCCdDir,
      target: context.serverTarget,
      ...managedOCCdDeployPolicy(context, appVersion, intent),
      ...(incumbent
        ? {
            census: incumbent.census,
            recountCensus: incumbent.recount,
            releaseIncumbentAdmission: incumbent.releaseAdmission
          }
        : {}),
      force: intent === 'force',
      appVersion,
      recordedNodeRuntimeProbe: true,
      nodeRuntimeDownload: WSL_NODE_RUNTIME_DOWNLOAD_BUDGET,
      ...extra
    }).catch((error: unknown) => {
      if (!signal?.aborted) {
        recordWslOCCdUpdateFailure(failureHost, incumbentVersion, {
          code: 'occd_update_failed',
          reason: errorMessage(error)
        })
      }
      throw error
    })
  const { deployed, woken } = await deployWslOCCdWithOneFence(
    slot,
    deployOnce,
    hints.deployPreRead(context.activationRecord)
  )
  if (deployed.outcome === 'installed-not-activated') {
    await removeFailedFreshWslOCCdInstall(slot, deployed)
    const failure = wslOCCdDeferralFailure(deployed)
    recordWslOCCdUpdateFailure(failureHost, incumbentVersion, failure)
    const restored =
      incumbentVersion && failure ? await readRestoredWslOCCdRecord(slot, incumbentVersion) : null
    if (restored) {
      // After rollback proof, serve the restored incumbent on this connect too.
      const retried = await admit(restored, 'connect')
      if ('outcome' in retried) {
        return retried
      }
    }
    const deferredUpdate: WslOCCdDeferredUpdate = {
      candidateVersion: deployed.fullVersion,
      code: await wslOCCdDeferralCode(slot, deployed, appVersion),
      reason: deployed.reason,
      forceable:
        isForceableOCCdDeferral(deployed.code) ||
        deployed.code === OCCD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Live-terminal deferrals keep the incumbent serving until Update/Force.
    if (
      incumbentVersion &&
      incumbent?.readiness &&
      isWaitingOCCdUpdateDeferral(deployed.code) &&
      // Another client may have activated since census; refuse stale incumbent assumptions.
      (await readOCCdActivationRecord(slot)).active === incumbentVersion
    ) {
      const serving = {
        fullVersion: incumbentVersion,
        readiness: incumbent.readiness
      }
      await pruneSupersededOCCdCandidates(slot, context.serverTarget, deployed.fullVersion)
      return { ...(await readyLaunch(serving)), deferredUpdate }
    }
    return { outcome: 'deferred', distro: name, ...deferredUpdate }
  }
  clearOCCdUpdateFailedThisLaunch(failureHost)
  const probe = async () => {
    const answer = await probeWslActiveOCCd(context, localOCCdDir, deployed.fullVersion, signal)
    probed = { fullVersion: deployed.fullVersion, pid: answer.pid }
    return answer.readiness
  }
  let readiness: ServeReadiness
  if (deployed.outcome === 'already-active') {
    // A stopped distro ended the active slot with it; the one-fence deploy already woke it.
    await (woken ? null : wakeAlreadyActiveOCCd(slot))
    // Why once more: on a distro still booting, the occd the wake saw serving can exit before
    // the probe; that is a stopped slot to start, not a failed connect.
    readiness = await probe().catch(async (error: unknown) => {
      if (!(error instanceof OCCdActiveReadinessError) || error.verdict !== 'exited') {
        throw error
      }
      // A `wsl --shutdown` during a no-boot connect must not be undone by this second wake.
      if (options.requireRunning && !(await options.requireRunning())) {
        throw new WslDistroNotRunningError(name)
      }
      await wakeAlreadyActiveOCCd(slot)
      return probe()
    })
  } else {
    readiness = await probe()
  }
  await pruneWslOCCdVersionsUntilClean(target.id, {
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployed.fullVersion,
    readiness
  })
  return readyLaunch({ fullVersion: deployed.fullVersion, readiness })

  async function readyLaunch(serving: {
    fullVersion: string
    readiness: ServeReadiness
  }): Promise<Extract<WslOCCdLaunch, { outcome: 'ready' }>> {
    // The serving probe already read it; an admission that serves an incumbent did not.
    const pid =
      probed?.fullVersion === serving.fullVersion
        ? probed.pid
        : await readWslOCCdPid(context, serving.fullVersion, signal)
    return {
      outcome: 'ready',
      distro: name,
      distroId: await distroId,
      port: occdBoundPort(serving.readiness) ?? OCCD_MANAGED_REMOTE_PORT,
      fullVersion: serving.fullVersion,
      pid,
      readiness: serving.readiness,
      holder: held.outcome,
      ...(adoption.outcome === 'adopted'
        ? { adoptedInstance: { version: adoption.version, pid: adoption.pid } }
        : {})
    }
  }
}

function defaultTransport(target: WslOCCdHostTarget): WslOCCdHostTransport {
  return createWslOCCdHostTransport({ target })
}

function userDataPath(): string {
  return getAppEnvironment().getPath('userData')
}
