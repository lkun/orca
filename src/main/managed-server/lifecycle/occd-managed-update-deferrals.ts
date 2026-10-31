import type { OCCdManagedDeferral } from '../../../shared/occd-managed-runtime'
import { compareAppVersions } from '../../../shared/app-version'

type RecordedDeferral = OCCdManagedDeferral & { deferredAt: string }

const deferrals = new Map<string, RecordedDeferral>()

export function recordManagedOCCdUpdateDeferral(
  environmentId: string,
  deferral: OCCdManagedDeferral,
  now = new Date()
): void {
  deferrals.set(environmentId, { ...deferral, deferredAt: now.toISOString() })
}

export function clearManagedOCCdUpdateDeferral(environmentId: string): void {
  deferrals.delete(environmentId)
}

function readManagedOCCdUpdateDeferral(environmentId: string): RecordedDeferral | null {
  return deferrals.get(environmentId) ?? null
}

/** Forget deferrals resolved by another desktop activating the candidate or a newer release. */
export function currentManagedOCCdUpdateDeferral(
  environmentId: string,
  activeVersion: string | null
): RecordedDeferral | null {
  const deferral = readManagedOCCdUpdateDeferral(environmentId)
  if (
    deferral &&
    activeVersion &&
    (activeVersion === deferral.candidateVersion ||
      compareAppVersions(activeVersion, deferral.candidateVersion) > 0)
  ) {
    clearManagedOCCdUpdateDeferral(environmentId)
    return null
  }
  return deferral
}
