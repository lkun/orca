/** Reuse SSH update admission: keep newer, rolled-back or launch-rejected incumbents serving; fenced activation replans before committing. */
import {
  OCCD_HOST_NEWER_DEFERRAL_CODE,
  OCCD_UPDATE_WSL_MOVE_RUNNING_CODE,
  type WslHostDeferredUpdate
} from '../../../shared/wsl-host-types'
import { refuseOCCdHostDowngrade } from '../../ssh/occd-host-version-admission'
import type { ServeReadiness } from '../../server/serve-readiness'
import type { OCCdActivationRecord } from '../../managed-server/activation/occd-activation-record'
import { readOCCdActivationRecord } from '../../managed-server/activation/occd-activation-record-store'
import { readOCCdActivationTransaction } from '../../managed-server/activation/occd-activation-transaction-store'
import { isWaitingOCCdUpdateDeferral } from '../../managed-server/lifecycle/occd-managed-auto-update'
import {
  occdUpdateSkipRefusal,
  planOCCdUpdateForIntent,
  type ManagedOCCdAutoUpdatePlan,
  type OCCdUpdateIntent
} from '../../managed-server/lifecycle/occd-managed-update-decision'
import {
  occdUpdateFailureThisLaunch,
  recordOCCdUpdateFailedThisLaunch,
  type OCCdUpdateFailure,
  type OCCdUpdateFailureHost
} from '../../managed-server/lifecycle/occd-managed-update-failure-memory'
import { OCCD_ACTIVATION_POLICY_REFUSED_CODE } from '../../ssh/occd-installed-activation'
import type { OCCdSlotOptions } from '../../ssh/occd-recovery-slot'
import { adoptRunningOCCdVersion } from '../../ssh/occd-running-version-adoption'
import type { WslOCCdLaunch } from './wsl-occd-deploy'

type WslOCCdReadyLaunch = Extract<WslOCCdLaunch, { outcome: 'ready' }>

export type WslOCCdUpdateAdmission =
  | {
      action: 'serve'
      version: string
      readiness: ServeReadiness
      deferredUpdate: WslHostDeferredUpdate | null
    }
  /** Another run holds the host fence; a later connect adopts or deploys. */
  | { action: 'defer'; deferredUpdate: WslHostDeferredUpdate }
  /** Deploy this app's build on this record. */
  | { action: 'deploy'; record: OCCdActivationRecord }

export async function admitWslOCCdUpdate(args: {
  slot: OCCdSlotOptions
  record: OCCdActivationRecord
  candidateVersion: string
  appVersion: string
  host: OCCdUpdateFailureHost
  intent: OCCdUpdateIntent
  /** A project move to this distro runs here: a redeploy would cut it off, even when forced. */
  moveRunning?: boolean
}): Promise<WslOCCdUpdateAdmission> {
  const { record, candidateVersion, appVersion } = args
  if (!record.active) {
    return { action: 'deploy', record }
  }
  const failure = occdUpdateFailureThisLaunch(args.host)
  const plan = planOCCdUpdateForIntent(args.intent, {
    record,
    candidateVersion,
    appVersion,
    failedBefore: failure !== null
  })
  const heldForMove = args.moveRunning === true && plan.action === 'update'
  if (!heldForMove && (plan.action !== 'skip' || plan.reason === 'current')) {
    return { action: 'deploy', record }
  }
  const adopted = await adoptRunningOCCdVersion(args.slot, record, candidateVersion)
  if (!adopted) {
    // Nothing active any more: deploy on the record the wake read; its fenced admission re-plans.
    return { action: 'deploy', record: await readOCCdActivationRecord(args.slot) }
  }
  if ('outcome' in adopted) {
    const { candidateVersion: version, code, reason, forceable } = adopted
    return {
      action: 'defer',
      deferredUpdate: { candidateVersion: version, code, reason, forceable: forceable === true }
    }
  }
  return {
    action: 'serve',
    version: adopted.version,
    readiness: adopted.readiness,
    deferredUpdate:
      adopted.version === candidateVersion
        ? null
        : heldForMove
          ? {
              candidateVersion,
              code: OCCD_UPDATE_WSL_MOVE_RUNNING_CODE,
              reason:
                'A project is moving to this WSL host; its server updates once the move finishes.',
              forceable: false
            }
          : skippedUpdateHint(plan, failure, record, candidateVersion, appVersion)
  }
}

/** The launch an admission ends in, or the record to deploy on. */
export async function admitWslOCCdLaunch(
  args: Parameters<typeof admitWslOCCdUpdate>[0],
  distro: string,
  readyLaunch: (serving: {
    fullVersion: string
    readiness: ServeReadiness
  }) => Promise<WslOCCdReadyLaunch>
): Promise<WslOCCdLaunch | OCCdActivationRecord> {
  const admission = await admitWslOCCdUpdate(args)
  if (admission.action === 'deploy') {
    return admission.record
  }
  if (admission.action === 'defer') {
    return { outcome: 'deferred', distro, ...admission.deferredUpdate }
  }
  const ready = await readyLaunch({
    fullVersion: admission.version,
    readiness: admission.readiness
  })
  return admission.deferredUpdate ? { ...ready, deferredUpdate: admission.deferredUpdate } : ready
}

/** Offer Update/Force for retriable host deferrals; newer hosts get no hint because Update cannot change that refusal. */
function skippedUpdateHint(
  plan: ManagedOCCdAutoUpdatePlan,
  failure: OCCdUpdateFailure | null,
  record: OCCdActivationRecord,
  candidateVersion: string,
  appVersion: string
): WslHostDeferredUpdate | null {
  if (plan.action !== 'skip') {
    return null
  }
  if (plan.reason === 'failed-before' && failure) {
    return { candidateVersion, ...failure, forceable: true }
  }
  const refusal =
    plan.reason === 'rolled-back'
      ? occdUpdateSkipRefusal(plan, record, candidateVersion, appVersion)
      : null
  return refusal
    ? {
        candidateVersion,
        code: OCCD_ACTIVATION_POLICY_REFUSED_CODE,
        reason: refusal,
        forceable: true
      }
    : null
}

/** Do not retry rejected/thrown incumbent updates this launch, matching SSH. Waits/policy refusals never attempted activation and record no failure. */
export function recordWslOCCdUpdateFailure(
  host: OCCdUpdateFailureHost,
  incumbentVersion: string | null,
  failure: OCCdUpdateFailure | null
): void {
  if (incumbentVersion && failure) {
    recordOCCdUpdateFailedThisLaunch(host, failure)
  }
}

export function wslOCCdDeferralFailure(deployed: {
  code: string
  reason: string
}): OCCdUpdateFailure | null {
  return isWaitingOCCdUpdateDeferral(deployed.code) ||
    deployed.code === OCCD_ACTIVATION_POLICY_REFUSED_CODE
    ? null
    : { code: deployed.code, reason: deployed.reason }
}

/** A policy refusal over a host a newer OCC runs gets its own code: an Update cannot pass it. */
export async function wslOCCdDeferralCode(
  slot: OCCdSlotOptions,
  deployed: { code: string; fullVersion: string },
  appVersion: string
): Promise<string> {
  if (deployed.code !== OCCD_ACTIVATION_POLICY_REFUSED_CODE) {
    return deployed.code
  }
  const record = await readOCCdActivationRecord(slot).catch(() => null)
  return record && refuseOCCdHostDowngrade(record, deployed.fullVersion, appVersion)
    ? OCCD_HOST_NEWER_DEFERRAL_CODE
    : deployed.code
}

/** The record only once the incumbent is back and no journal awaits recovery; else null. */
export async function readRestoredWslOCCdRecord(
  slot: OCCdSlotOptions,
  incumbent: string
): Promise<OCCdActivationRecord | null> {
  // Unreadable transaction state proves no restoration; preserve the rejection.
  if (await readOCCdActivationTransaction(slot).catch(() => true)) {
    return null
  }
  const record = await readOCCdActivationRecord(slot).catch(() => null)
  return record?.active === incumbent ? record : null
}
