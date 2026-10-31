/**
 * A same-version WSL connect takes one activation fence instead of two: the deploy confirms the
 * slot is installed and skips its own fence, then the wake's fence re-reads the record and starts
 * the slot if it stopped. A fence the snapshot saw held, another version active by then, or a busy
 * fence all run the full deploy and wake, as before.
 */
import type { OCCdActivationRecord } from '../managed-server/activation/occd-activation-record'
import { wakeExpectedOCCdUnderOneFence } from '../managed-server/lifecycle/occd-managed-wake'
import type { OCCdDeployOptions, OCCdDeployResult } from '../ssh/occd-remote-deploy'
import type { OCCdSlotOptions } from '../ssh/occd-recovery-slot'

type DeployExtra = Pick<OCCdDeployOptions, 'preRead' | 'sameVersionFencedByCaller'>

export async function deployWslOCCdWithOneFence(
  slot: OCCdSlotOptions,
  deploy: (extra: DeployExtra) => Promise<OCCdDeployResult>,
  hinted: { preRead?: { record: OCCdActivationRecord; fenceOpen: boolean } }
): Promise<{ deployed: OCCdDeployResult; woken: boolean }> {
  if (!hinted.preRead?.fenceOpen) {
    return { deployed: await deploy(hinted), woken: false }
  }
  const first = await deploy({ ...hinted, sameVersionFencedByCaller: true })
  if (first.outcome !== 'already-active') {
    return { deployed: first, woken: false }
  }
  const wake = await wakeExpectedOCCdUnderOneFence(slot, first.fullVersion)
  if (wake.outcome === 'replan' || wake.outcome === 'fenced') {
    // The host moved since the snapshot, so this deploy takes no hints.
    return { deployed: await deploy({}), woken: false }
  }
  if (wake.outcome === 'recovery-refused') {
    throw new Error(wake.reason)
  }
  return { deployed: first, woken: true }
}
