/** Pin every journaled slot needed for recovery. An unreadable journal or unjournaled held fence hides transaction state, so GC must retain everything. */
import { occdInstallDirNames } from '../managed-server/activation/occd-activation-record'
import type { OCCdActivationTransaction } from '../managed-server/activation/occd-activation-transaction'
import { readOCCdActivationTransaction } from '../managed-server/activation/occd-activation-transaction-store'
import { occdActivationFenceExists } from '../managed-server/activation/occd-activation-lock'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import type { OCCdRemoteExecTarget } from '../managed-server/install/occd-remote-runtime-control'

type OCCdGcTransactionPins = { state: 'pinned'; dirNames: string[] } | { state: 'keep-all' }

function transactionVersions(transaction: OCCdActivationTransaction): (string | null)[] {
  const records = [transaction.recordBefore, transaction.recordAfter]
  const fromRecords = records.flatMap((record) => (record ? [record.active, record.previous] : []))
  if (transaction.operation === 'activate') {
    return [...fromRecords, transaction.candidateVersion]
  }
  return transaction.operation === 'rollback'
    ? [...fromRecords, transaction.incumbentVersion, transaction.targetVersion]
    : fromRecords
}

export async function readOCCdGcTransactionPins(
  target: OCCdRemoteExecTarget & { remoteHome: string }
): Promise<OCCdGcTransactionPins> {
  try {
    const transaction = await readOCCdActivationTransaction(target)
    if (!transaction) {
      // An unjournaled fence may be a transaction starting or an interrupted release.
      return (await occdActivationFenceExists(target))
        ? { state: 'keep-all' }
        : { state: 'pinned', dirNames: [] }
    }
    return { state: 'pinned', dirNames: occdInstallDirNames(transactionVersions(transaction)) }
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return { state: 'keep-all' }
  }
}
