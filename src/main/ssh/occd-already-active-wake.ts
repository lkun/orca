import { wakeStoppedManagedOCCd } from '../managed-server/lifecycle/occd-managed-wake'
import type { OCCdSlotOptions } from './occd-recovery-slot'

/** Already-active deploys launch nothing; wake that slot only on proven exit, including after reboot. Return whether it was started. */
export async function wakeAlreadyActiveOCCd(options: OCCdSlotOptions): Promise<boolean> {
  const wake = await wakeStoppedManagedOCCd(options)
  if (wake.outcome === 'recovery-refused') {
    throw new Error(wake.reason)
  }
  return wake.outcome === 'started'
}
