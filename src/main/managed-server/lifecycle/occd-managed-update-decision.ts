import { compareAppVersions, isValidAppVersion } from '../../../shared/app-version'
import type { OCCdActivationRecord } from '../activation/occd-activation-record'
import {
  refuseOCCdHostDowngrade,
  type OCCdHostVersionRefusal
} from '../../ssh/occd-host-version-admission'

export type ManagedOCCdAutoUpdateSkip =
  | 'current'
  | 'no-template'
  | 'rolled-back'
  | 'failed-before'
  | 'migrating'
  | OCCdHostVersionRefusal

/** Connect honors all skips; Update retries local failures/rollbacks; Force also lifts version skips. */
export type OCCdUpdateIntent = 'connect' | 'update' | 'force'

export type ManagedOCCdAutoUpdatePlan =
  | { action: 'update' }
  | { action: 'skip'; reason: ManagedOCCdAutoUpdateSkip }

export function planManagedOCCdAutoUpdate(input: {
  record: OCCdActivationRecord
  candidateVersion: string | null
  appVersion: string
  failedBefore: boolean
}): ManagedOCCdAutoUpdatePlan {
  const { record, candidateVersion } = input
  if (!candidateVersion) {
    return { action: 'skip', reason: 'no-template' }
  }
  if (record.active === candidateVersion) {
    return { action: 'skip', reason: 'current' }
  }
  if (record.rolledBackFrom === candidateVersion) {
    return { action: 'skip', reason: 'rolled-back' }
  }
  const refusal = refuseOCCdHostDowngrade(record, candidateVersion, input.appVersion)
  if (refusal) {
    return { action: 'skip', reason: refusal }
  }
  // A stopped host has no serving fallback; retry even after a prior failed attempt.
  if (record.active === null && record.previous !== null) {
    return { action: 'update' }
  }
  return input.failedBefore ? { action: 'skip', reason: 'failed-before' } : { action: 'update' }
}

export function planOCCdUpdateForIntent(
  intent: OCCdUpdateIntent,
  input: Parameters<typeof planManagedOCCdAutoUpdate>[0]
): ManagedOCCdAutoUpdatePlan {
  if (intent === 'force') {
    return { action: 'update' }
  }
  if (intent === 'connect') {
    return planManagedOCCdAutoUpdate(input)
  }
  const { rolledBackFrom: _retried, ...record } = input.record
  return planManagedOCCdAutoUpdate({ ...input, record, failedBefore: false })
}

export function admitOCCdRecordForIntent(
  intent: OCCdUpdateIntent,
  appVersion: string
): (record: OCCdActivationRecord, candidateVersion: string) => string | null {
  return (record, candidateVersion) =>
    occdUpdateSkipRefusal(
      planOCCdUpdateForIntent(intent, {
        record,
        candidateVersion,
        appVersion,
        failedBefore: false
      }),
      record,
      candidateVersion,
      appVersion
    )
}

export function occdUpdateSkipRefusal(
  plan: ManagedOCCdAutoUpdatePlan,
  record: OCCdActivationRecord,
  candidateVersion: string,
  appVersion: string
): string | null {
  if (plan.action !== 'skip' || plan.reason === 'current') {
    return null
  }
  return plan.reason === 'rolled-back'
    ? `This host's server rolled back from ${candidateVersion}, so a connect does not activate ` +
        'it again; choose Update or Force to retry it.'
    : `OCC ${record.activeAppVersion} last ran this host's server, newer than this ` +
        `OCC (${appVersion}). Update OCC to start it.`
}

/** Content hashes cannot order updates: compare OCC versions, or for legacy hosts offer only this desktop's previously deferred build. */
export function availableManagedOCCdUpdate(input: {
  record: OCCdActivationRecord
  candidateVersion: string | null
  appVersion: string
  /** The build this desktop's last Update or connect deferred on this host. */
  deferredCandidateVersion: string | null
}): string | null {
  const { record, candidateVersion, appVersion } = input
  const hostAppVersion = record.activeAppVersion
  if (!candidateVersion || record.active === null || !isValidAppVersion(appVersion)) {
    return null
  }
  const ordered = hostAppVersion
    ? isValidAppVersion(hostAppVersion) && compareAppVersions(appVersion, hostAppVersion) >= 0
    : input.deferredCandidateVersion === candidateVersion
  if (!ordered) {
    return null
  }
  // Connect rules: a build the user rolled back from is not advertised again.
  const plan = planManagedOCCdAutoUpdate({
    record,
    candidateVersion,
    appVersion,
    failedBefore: false
  })
  return plan.action === 'update' ? candidateVersion : null
}
