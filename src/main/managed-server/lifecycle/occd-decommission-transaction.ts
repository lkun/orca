// Only process-exited may commit; dispatched phases nest under prepared for released readers.
import {
  serializeOCCdActivationRecord,
  withDeactivatedVersion,
  withDeactivatedVersionCommitted,
  type OCCdActivationRecord
} from '../activation/occd-activation-record'
import { OCCD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from '../activation/occd-activation-transaction-schema'
import type { OCCdManagedStopRequest } from '../../../shared/occd-stop-request'

export type OCCdDecommissionTransaction = {
  schemaVersion: typeof OCCD_ACTIVATION_TRANSACTION_SCHEMA_VERSION
  transactionId: string
  operation: 'decommission'
  phase: 'prepared' | 'stop-dispatched' | 'process-exited'
  startedAt: string
  updatedAt: string
  activeVersion: string
  recordBefore: OCCdActivationRecord
  recordAfter: OCCdActivationRecord
  request: OCCdManagedStopRequest | null
}

/** Released desktops drop this field. */
type OCCdDecommissionDispatch = {
  phase: 'stop-dispatched' | 'process-exited'
  request: OCCdManagedStopRequest
}

type OCCdDecommissionJournal = Omit<OCCdDecommissionTransaction, 'phase' | 'request'> & {
  phase: 'prepared'
  request: null
  dispatched?: OCCdDecommissionDispatch
}

export type OCCdDecommissionRecoveryPlan =
  | { action: 'confirm-decommissioned'; version: string; record: OCCdActivationRecord | null }
  /** Completion or cancellation must settle a possibly delivered request. */
  | { action: 'resume-stop'; request: OCCdManagedStopRequest; record: OCCdActivationRecord }
  | { action: 'keep-serving'; version: string }

export function createOCCdDecommissionTransaction(options: {
  transactionId: string
  recordBefore: OCCdActivationRecord & { active: string }
  now: Date
}): OCCdDecommissionTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: OCCD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'decommission',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    activeVersion: options.recordBefore.active,
    recordBefore: options.recordBefore,
    recordAfter: withDeactivatedVersion(options.recordBefore),
    request: null
  }
}

export function withOCCdDecommissionStopDispatched(
  transaction: OCCdDecommissionTransaction,
  request: OCCdManagedStopRequest,
  now: Date
): OCCdDecommissionTransaction {
  return { ...transaction, phase: 'stop-dispatched', updatedAt: now.toISOString(), request }
}

export function withOCCdDecommissionProcessExited(
  transaction: OCCdDecommissionTransaction,
  now: Date
): OCCdDecommissionTransaction {
  return { ...transaction, phase: 'process-exited', updatedAt: now.toISOString() }
}

/** Keep top-level prepared so released readers relaunch the recorded build instead of downgrading.
 * Their parser drops dispatched; their completed-stop path loses activeAppVersion protection. */
export function occdDecommissionJournal(
  transaction: OCCdDecommissionTransaction
): OCCdDecommissionJournal {
  const { phase, request, ...rest } = transaction
  return phase === 'prepared' || !request
    ? { ...rest, phase: 'prepared', request: null }
    : { ...rest, phase: 'prepared', request: null, dispatched: { phase, request } }
}

export function occdDecommissionTransactionDefect(
  transaction: OCCdDecommissionTransaction
): string | null {
  if (transaction.recordBefore.active !== transaction.activeVersion) {
    return 'decommission version does not match recordBefore'
  }
  if (
    serializeOCCdActivationRecord(transaction.recordAfter) !==
    serializeOCCdActivationRecord(withDeactivatedVersion(transaction.recordBefore))
  ) {
    return 'recordAfter is not the deactivated recordBefore'
  }
  if (transaction.request && transaction.request.version !== transaction.activeVersion) {
    return 'stop request names another version'
  }
  return null
}

export function planOCCdDecommissionRecovery(
  transaction: OCCdDecommissionTransaction,
  committed: boolean
): OCCdDecommissionRecoveryPlan {
  if (committed) {
    return { action: 'confirm-decommissioned', version: transaction.activeVersion, record: null }
  }
  if (transaction.phase === 'process-exited') {
    return {
      action: 'confirm-decommissioned',
      version: transaction.activeVersion,
      record: committedOCCdDecommissionRecord(transaction)
    }
  }
  if (transaction.phase === 'stop-dispatched' && transaction.request) {
    return {
      action: 'resume-stop',
      request: transaction.request,
      record: committedOCCdDecommissionRecord(transaction)
    }
  }
  return { action: 'keep-serving', version: transaction.activeVersion }
}

/** Preserve advisory fields alongside the journaled recordAfter. */
export function committedOCCdDecommissionRecord(
  transaction: OCCdDecommissionTransaction
): OCCdActivationRecord {
  return withDeactivatedVersionCommitted(transaction.recordBefore)
}
