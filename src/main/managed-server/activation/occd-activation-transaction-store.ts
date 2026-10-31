import {
  occdActivationTransactionPath,
  parseOCCdActivationTransaction,
  serializeOCCdActivationTransaction,
  type OCCdActivationTransaction
} from './occd-activation-transaction'
import {
  readBoundedOCCdRemoteRecord,
  writeAtomicOCCdRemoteRecord
} from '../install/occd-remote-record-file'
import type { OCCdRemoteExecTarget } from '../install/occd-remote-runtime-control'
import { currentOCCdFence } from './occd-activation-fence-scope'

const OCCD_ACTIVATION_TRANSACTION_MAX_BYTES = 64 * 1024

type OCCdActivationTransactionStoreOptions = OCCdRemoteExecTarget & { remoteHome: string }

/** Only verified absence returns null; unreadable journals retain the fence. */
export async function readOCCdActivationTransaction(
  options: OCCdActivationTransactionStoreOptions
): Promise<OCCdActivationTransaction | null> {
  const read = await readBoundedOCCdRemoteRecord(
    options,
    occdActivationTransactionPath(options.host, options.remoteHome),
    OCCD_ACTIVATION_TRANSACTION_MAX_BYTES
  )
  const parsed = parseOCCdActivationTransaction(read.state === 'present' ? read.raw : null)
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's occd activation transaction: ${parsed.reason}`)
  }
  return parsed.state === 'ok' ? parsed.transaction : null
}

/** Stamp each write with its fence generation so release cannot delete another holder's journal. */
export function writeOCCdActivationTransaction(
  options: OCCdActivationTransactionStoreOptions,
  transaction: OCCdActivationTransaction
): Promise<void> {
  const fenceToken = currentOCCdFence()?.token
  return writeAtomicOCCdRemoteRecord(
    options,
    occdActivationTransactionPath(options.host, options.remoteHome),
    serializeOCCdActivationTransaction(fenceToken ? { ...transaction, fenceToken } : transaction)
  )
}
