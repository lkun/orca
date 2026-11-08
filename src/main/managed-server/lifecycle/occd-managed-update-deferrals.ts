import type { OCCdManagedDeferral } from '../../../shared/occd-managed-runtime'
import type { OCCdActivationRecord } from '../activation/occd-activation-record'

type RecordedDeferral = OCCdManagedDeferral & { deferredAt: string }

/** Which activation a host is on: a version alone repeats when a host moves away and back. */
export type OCCdIncumbent = Pick<OCCdActivationRecord, 'active' | 'activatedAt'>

type StoredDeferral = RecordedDeferral & {
  /** The host's activation when the deferral was recorded. */
  incumbentAtDeferral: OCCdIncumbent
}

const deferrals = new Map<string, StoredDeferral>()

export function recordManagedOCCdUpdateDeferral(
  environmentId: string,
  deferral: OCCdManagedDeferral,
  incumbent: OCCdIncumbent,
  now = new Date()
): void {
  deferrals.set(environmentId, {
    ...deferral,
    deferredAt: now.toISOString(),
    incumbentAtDeferral: { active: incumbent.active, activatedAt: incumbent.activatedAt }
  })
}

export function clearManagedOCCdUpdateDeferral(environmentId: string): void {
  deferrals.delete(environmentId)
}

/** Forget a deferral once the host's activation moves, since it described a host state that is gone
 *  (builds of one release differ only by an unorderable content hash, #38400), or once its candidate
 *  is the build the host runs, since nothing is left to update. */
export function currentManagedOCCdUpdateDeferral(
  environmentId: string,
  incumbent: OCCdIncumbent
): RecordedDeferral | null {
  const stored = deferrals.get(environmentId)
  if (!stored) {
    return null
  }
  const { incumbentAtDeferral, ...deferral } = stored
  if (
    incumbent.active === deferral.candidateVersion ||
    incumbentAtDeferral.active !== incumbent.active ||
    incumbentAtDeferral.activatedAt !== incumbent.activatedAt
  ) {
    clearManagedOCCdUpdateDeferral(environmentId)
    return null
  }
  return deferral
}
