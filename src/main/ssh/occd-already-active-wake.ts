import {
  OCCdCrashLoopError,
  wakeManagedOCCdUnlessCrashLooping
} from '../managed-server/lifecycle/occd-managed-crash-loop'
import { wakeStoppedManagedOCCd } from '../managed-server/lifecycle/occd-managed-wake'
import type { OCCdSlotOptions } from './occd-recovery-slot'

/** Already-active deploys launch nothing; wake that slot only on proven exit, including after reboot. Return whether it was started. */
export async function wakeAlreadyActiveOCCd(
  options: OCCdSlotOptions,
  /** SSH-managed hosts share the crash-loop brake with every other automatic wake. */
  managed?: { environmentId: string; hostLabel: string }
): Promise<boolean> {
  const wake = managed
    ? await wakeManagedOCCdUnlessCrashLooping(managed.environmentId, managed.hostLabel, options)
    : await wakeStoppedManagedOCCd(options)
  if (wake.outcome === 'crash-loop') {
    throw new OCCdCrashLoopError(wake.detail)
  }
  if (wake.outcome === 'recovery-refused') {
    throw new Error(wake.reason)
  }
  return wake.outcome === 'started'
}
