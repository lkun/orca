import type { OCCdActivationLockControl } from '../managed-server/activation/occd-activation-lock'
import type { OCCdSnapshotVerdict } from '../managed-server/activation/occd-activation-transaction'
import { occdStopFreedTheHost } from '../managed-server/install/occd-remote-process-control'
import { withoutAbortSignal } from '../managed-server/install/occd-remote-runtime-control'
import {
  launchOCCdSlot,
  stopOCCdSlot,
  OCCD_SLOT_STOP_WAIT_SECONDS,
  type OCCdSlotIdentity,
  type OCCdSlotOptions
} from './occd-recovery-slot'
import { recoverOCCdIncumbent } from './occd-incumbent-recovery'
import { errorMessage } from '../../shared/error-message'

/** Return null on proven exit; otherwise retain the fence when a delivered stop may still change the host. */
export async function stopTransactionIncumbent(
  options: OCCdSlotOptions,
  incumbent: OCCdSlotIdentity,
  lock: OCCdActivationLockControl
): Promise<{ reason: string; stopMayBeUnderway: boolean } | null> {
  const stopped = await stopOCCdSlot(options, incumbent.remoteDir, false)
  if (occdStopFreedTheHost(stopped)) {
    return null
  }
  // Only a stop that may have been delivered can still change the host; otherwise nothing happened.
  const stopMayBeUnderway = stopped === 'still-running' || stopped === 'unconfirmed'
  if (stopMayBeUnderway) {
    lock.retain()
  }
  return {
    reason:
      `Could not verify that occd ${incumbent.version} exited within ` +
      `${OCCD_SLOT_STOP_WAIT_SECONDS}s (${stopped}).`,
    stopMayBeUnderway
  }
}

export async function restartAfterSnapshotFailure(
  options: OCCdSlotOptions,
  incumbent: OCCdSlotIdentity,
  lock: OCCdActivationLockControl
): Promise<string> {
  try {
    await launchOCCdSlot(withoutAbortSignal(options), incumbent)
    lock.recovered()
    return `occd ${incumbent.version} was restarted and is serving again.`
  } catch (error) {
    lock.retain()
    return `restarting occd ${incumbent.version} failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Restore changed state and incumbent only after both slots prove exit; refusal retains the fence. */
export async function putTransactionIncumbentBack(
  options: OCCdSlotOptions,
  lock: OCCdActivationLockControl,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: OCCdSlotIdentity | null
    restoreState: OCCdSnapshotVerdict | null
    launchedFromState?: OCCdSnapshotVerdict | null
  }
): Promise<string | null> {
  try {
    const recovery = await recoverOCCdIncumbent(withoutAbortSignal(options), {
      ...input,
      slotsProvenExited: true
    })
    if (recovery.outcome === 'refused') {
      lock.retain()
      return recovery.reason
    }
    lock.recovered()
    return null
  } catch (error) {
    lock.retain()
    return `Restoring the previous version failed: ${errorMessage(error)} This host requires recovery.`
  }
}

/** Stop the rejected candidate before safely restoring incumbent state. */
export async function restoreAfterRejectedCandidate(
  options: OCCdSlotOptions,
  lock: OCCdActivationLockControl,
  input: {
    launchedDir: string
    launchedVersion: string
    transactionStartedAt: string
    incumbent: OCCdSlotIdentity | null
    restoreState: OCCdSnapshotVerdict | null
    launchedFromState?: OCCdSnapshotVerdict | null
  }
): Promise<string> {
  const { launchedDir, ...restore } = input
  const stopped = await stopOCCdSlot(withoutAbortSignal(options), launchedDir, true).catch(
    (error: unknown) => `unverifiable: ${errorMessage(error)}`
  )
  if (stopped !== 'stopped' && stopped !== 'already-exited') {
    lock.retain()
    return (
      `occd ${input.launchedVersion} could not be confirmed stopped (${stopped}), so nothing ` +
      'was restored over state it may still own. This host requires recovery.'
    )
  }
  const failure = await putTransactionIncumbentBack(options, lock, restore)
  return (
    failure ??
    (input.incumbent
      ? `occd ${input.incumbent.version} was restarted and is serving again.`
      : 'No previous version was active, so this host is now serving nothing.')
  )
}
