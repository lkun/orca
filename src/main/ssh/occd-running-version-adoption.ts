/** Pair with an already-running foreign build before considering update; an unpaired first deploy cannot census its terminals. */
import type { ServeReadiness } from '../server/serve-readiness'
import type { OCCdManagedDeferral } from '../../shared/occd-managed-runtime'
import { occdActivationFenceRefusal } from '../managed-server/activation/occd-activation-fence-hold'
import { OCCdActiveReadinessError, probeActiveOCCdReadiness } from './occd-active-readiness'
import type { OCCdActivationRecord } from '../managed-server/activation/occd-activation-record'
import { readOCCdActivationRecord } from '../managed-server/activation/occd-activation-record-store'
import { wakeStoppedManagedOCCd } from '../managed-server/lifecycle/occd-managed-wake'
import { resolveOCCdSlotIdentity, type OCCdSlotOptions } from './occd-recovery-slot'

export type OCCdRunningAdoption = {
  version: string
  readiness: ServeReadiness
  /** Reads the adopted slot's readiness again, e.g. after it rebinds its port. */
  reprobe: () => Promise<ServeReadiness>
}

/** No foreign activation returns null for normal deploy. A held peer fence defers: deploying without pairing would only fail census (#28833). */
export async function adoptRunningOCCdVersion(
  slot: OCCdSlotOptions,
  record: OCCdActivationRecord,
  localVersion: string,
  retryClearedFence = true
): Promise<OCCdRunningAdoption | OCCdManagedDeferral | null> {
  if (!record.active || record.active === localVersion) {
    return null
  }
  // Wake only on proven server exit; idle stops leave daemon terminals alive.
  const wake = await wakeStoppedManagedOCCd(slot)
  switch (wake.outcome) {
    // Another desktop stopped it meanwhile; the deploy's own gates decide.
    case 'not-activated':
      return null
    case 'fenced': {
      // E.g. another desktop starting it after a reboot; a later connect pairs with it.
      const { cleared, ...refusal } = await occdActivationFenceRefusal(slot, 'server start')
      if (cleared && retryClearedFence) {
        return adoptRunningOCCdVersion(slot, record, localVersion, false)
      }
      return { outcome: 'deferred', candidateVersion: localVersion, ...refusal, forceable: false }
    }
    case 'unverifiable':
      throw new OCCdActiveReadinessError(
        'unverifiable',
        `OCC ${record.active} runs this host's server, but its process state is unverifiable, ` +
          'so it was left as it is. Try connecting again.'
      )
    case 'recovery-refused':
      throw new Error(wake.reason)
    case 'serving':
    case 'started':
      break
  }
  // Re-read activation because wake follows peer changes to the current record.
  const active = (await readOCCdActivationRecord(slot)).active
  if (!active || active === localVersion) {
    return null
  }
  const identity = await resolveOCCdSlotIdentity(slot, active)
  const reprobe = () =>
    probeActiveOCCdReadiness(
      { ...slot, remoteInstallDir: identity.remoteDir },
      { buildHash: identity.buildHash, fullVersion: identity.version }
    )
  return { version: active, readiness: await reprobe(), reprobe }
}
