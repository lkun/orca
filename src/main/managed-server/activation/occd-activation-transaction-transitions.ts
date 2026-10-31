import type { OCCdActivationRecord } from './occd-activation-record'
import { OCCD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from './occd-activation-transaction-schema'
import type {
  OCCdActivateTransaction,
  OCCdRollbackTransaction
} from './occd-activation-transaction'

export function createOCCdActivationTransaction(options: {
  transactionId: string
  candidateVersion: string
  appVersion?: string
  recordBefore: OCCdActivationRecord
  snapshotDirName: string
  now: Date
}): OCCdActivateTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: OCCD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'activate',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    candidateVersion: options.candidateVersion,
    candidateAppVersion: options.appVersion ?? null,
    recordBefore: options.recordBefore,
    recordAfter: null,
    snapshot: { dirName: options.snapshotDirName, state: 'pending' }
  }
}

export function withOCCdActivationIncumbentStopped(
  transaction: OCCdActivateTransaction,
  now: Date
): OCCdActivateTransaction {
  return {
    ...transaction,
    phase: 'incumbent-stopped',
    updatedAt: now.toISOString()
  }
}

export function withOCCdActivationSnapshot(
  transaction: OCCdActivateTransaction,
  state: 'captured' | 'empty',
  now: Date
): OCCdActivateTransaction {
  return {
    ...transaction,
    phase: 'snapshot-captured',
    updatedAt: now.toISOString(),
    snapshot: { dirName: transaction.snapshot.dirName, state }
  }
}

export function withOCCdActivationCandidateReady(
  transaction: OCCdActivateTransaction,
  recordAfter: OCCdActivationRecord,
  now: Date
): OCCdActivateTransaction {
  return {
    ...transaction,
    phase: 'candidate-ready',
    updatedAt: now.toISOString(),
    recordAfter
  }
}

export function createOCCdRollbackTransaction(options: {
  transactionId: string
  incumbentVersion: string
  targetVersion: string
  recordBefore: OCCdActivationRecord
  recordAfter: OCCdActivationRecord
  rescueDirName: string
  now: Date
}): OCCdRollbackTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: OCCD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'rollback',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    incumbentVersion: options.incumbentVersion,
    targetVersion: options.targetVersion,
    recordBefore: options.recordBefore,
    recordAfter: options.recordAfter,
    rescue: { dirName: options.rescueDirName, state: 'pending' }
  }
}

export function withOCCdRollbackPhase(
  transaction: OCCdRollbackTransaction,
  phase: 'incumbent-stopped' | 'rollback-state-restored' | 'target-ready',
  now: Date
): OCCdRollbackTransaction {
  return { ...transaction, phase, updatedAt: now.toISOString() }
}

export function withOCCdRollbackRescue(
  transaction: OCCdRollbackTransaction,
  state: 'captured' | 'empty',
  now: Date
): OCCdRollbackTransaction {
  return {
    ...transaction,
    phase: 'rescue-captured',
    updatedAt: now.toISOString(),
    rescue: { dirName: transaction.rescue.dirName, state }
  }
}
