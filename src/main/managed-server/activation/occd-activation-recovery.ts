// Reconcile interrupted transactions to the recorded slot and state; retain the fence whenever ownership remains unproven.
import type { ServeReadiness } from '../../server/serve-readiness'
import {
  planOCCdTransactionRecovery,
  type OCCdActivationTransaction
} from './occd-activation-transaction'
import { readOCCdActivationTransaction } from './occd-activation-transaction-store'
import {
  readOCCdActivationRecord,
  writeOCCdActivationRecord
} from './occd-activation-record-store'
import {
  occdActivationFenceExists,
  withStaleOCCdActivationRecoveryLock
} from './occd-activation-lock'
import { RemoteInstallLockBusyError } from '../install/remote-install-lock'
import { ensureOCCdSlotServing, resolveOCCdSlotIdentity } from '../../ssh/occd-recovery-slot'
import { reconcileOCCdDecommission } from '../lifecycle/occd-decommission-recovery'
import {
  recoverOCCdIncumbent,
  type OCCdIncumbentRecoveryOptions
} from '../../ssh/occd-incumbent-recovery'
import type { OCCdManagedRefusal } from '../../../shared/occd-managed-runtime'
import { resumeInterruptedOCCdCandidate } from '../../ssh/occd-interrupted-candidate-resume'
import { errorMessage } from '../../../shared/error-message'
import { isOCCdLaunchFailure } from '../../ssh/occd-launch-failure'

export type OCCdActivationRecoveryResult =
  | { outcome: 'none' }
  | { outcome: 'pending'; code: string; reason: string }
  | {
      outcome: 'recovered'
      resolution: 'committed' | 'restored-incumbent'
      activeVersion: string | null
      readiness: ServeReadiness | null
    }
  /** A launch failure behind an unverifiable refusal still ended a run. */
  | (OCCdManagedRefusal & { launchFailure?: Error })

type OCCdActivationRecoveryOptions = OCCdIncumbentRecoveryOptions

export const OCCD_RECOVERY_UNVERIFIABLE_CODE = 'occd_recovery_unverifiable'

/** Both pre-fence answers, read moments ago on this connect; they only skip the same two reads. */
export type OCCdActivationIdlePreRead = { transactionAbsent: boolean; fenceOpen: boolean }

export async function recoverInterruptedOCCdActivation(
  options: OCCdActivationRecoveryOptions,
  preRead?: OCCdActivationIdlePreRead
): Promise<OCCdActivationRecoveryResult> {
  if (preRead?.transactionAbsent && preRead.fenceOpen) {
    return { outcome: 'none' }
  }
  try {
    if (
      !(await readOCCdActivationTransaction(options)) &&
      !(await occdActivationFenceExists(options))
    ) {
      return { outcome: 'none' }
    }
    return await withStaleOCCdActivationRecoveryLock(options, async (lock) => {
      const transaction = await readOCCdActivationTransaction(options)
      if (!transaction) {
        // Interrupted release can remove the journal before the fence; finishing release is enough.
        return { outcome: 'none' }
      }
      const result = await reconcileOCCdTransaction(options, transaction)
      if (result.outcome !== 'recovered') {
        lock.retain()
      }
      return result
    })
  } catch (error) {
    if (error instanceof RemoteInstallLockBusyError) {
      return {
        outcome: 'pending',
        code: 'occd_recovery_transaction_still_fresh',
        reason:
          'The activation fence is held by a run that may still be working. Retry after the ' +
          'install lock recovery window.'
      }
    }
    return {
      outcome: 'refused',
      verdict: 'unverifiable',
      code: OCCD_RECOVERY_UNVERIFIABLE_CODE,
      reason:
        `The interrupted activation could not be reconciled safely: ${errorMessage(error)} ` +
        'The host remains fenced.',
      ...(isOCCdLaunchFailure(error) ? { launchFailure: error } : {})
    }
  }
}

/** Requires a held fence; unverifiable steps throw to preserve it. */
async function reconcileOCCdTransaction(
  options: OCCdActivationRecoveryOptions,
  transaction: OCCdActivationTransaction
): Promise<OCCdActivationRecoveryResult> {
  const plan = planOCCdTransactionRecovery(transaction, await readOCCdActivationRecord(options))
  if (plan.action === 'refuse') {
    return { outcome: 'refused', verdict: 'unverifiable', code: plan.code, reason: plan.reason }
  }
  if (
    plan.action === 'confirm-decommissioned' ||
    plan.action === 'resume-stop' ||
    plan.action === 'keep-serving'
  ) {
    return reconcileOCCdDecommission(options, plan)
  }
  if (plan.action === 'finish-commit') {
    await writeOCCdActivationRecord(options, plan.record)
  }
  if (plan.action === 'stabilize-committed' || plan.action === 'finish-commit') {
    const activeVersion = plan.action === 'finish-commit' ? plan.record.active : plan.activeVersion
    if (!activeVersion) {
      throw new Error('The committed activation record has no active version.')
    }
    const identity = await resolveOCCdSlotIdentity(options, activeVersion)
    return {
      outcome: 'recovered',
      resolution: 'committed',
      activeVersion,
      readiness: await ensureOCCdSlotServing(options, identity)
    }
  }
  let launchFailure: Error | undefined
  if (transaction.operation === 'activate' && plan.launchedVersion) {
    const readiness = await resumeInterruptedOCCdCandidate(options, transaction)
    if (readiness && 'outcome' in readiness) {
      return readiness
    }
    if (readiness && 'launchFailure' in readiness) {
      launchFailure = readiness.launchFailure
    } else if (readiness) {
      return {
        outcome: 'recovered',
        resolution: 'committed',
        activeVersion: transaction.candidateVersion,
        readiness
      }
    }
  }
  const recovery = await recoverOCCdIncumbent(options, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: plan.launchedVersion,
    incumbent: plan.activeVersion
      ? await resolveOCCdSlotIdentity(options, plan.activeVersion)
      : null,
    restoreState: plan.restoreState,
    launchedFromState: plan.launchedFromState
  })
  return recovery.outcome === 'refused'
    ? { ...recovery, ...(launchFailure ? { launchFailure } : {}) }
    : {
        outcome: 'recovered',
        resolution: 'restored-incumbent',
        activeVersion: plan.activeVersion,
        readiness: recovery.readiness
      }
}
