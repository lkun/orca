import { lstatSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { z } from 'zod'
import { readNodeFileSyncWithinLimit } from '../../shared/file-content/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../shared/secure-storage/secure-file'
import { hasErrorCode } from '../daemon/endpoint/identity/daemon-process-inspection'
import {
  OCCD_STOP_RECEIPTS_DIRNAME,
  OCCdCompletedStopReceiptSchema,
  OCCdManagedStopRequestSchema,
  OCCdDaemonRetirementRecordSchema,
  occdManagedStopRequestKey,
  type OCCdCompletedStopReceipt,
  type OCCdDaemonRetirementRecord,
  type OCCdManagedStopRequest
} from '../../shared/occd-stop-request'

const RECEIPT_MAX_BYTES = 64 * 1024

type ReceiptKind = 'completed' | 'retirement' | 'decision'

export function occdStopReceiptPath(request: OCCdManagedStopRequest, kind: ReceiptKind): string {
  const { transactionId, instance } = OCCdManagedStopRequestSchema.parse(request)
  const suffix = kind === 'completed' ? '' : `.${kind}`
  return join(
    dirname(instance.lockPath),
    OCCD_STOP_RECEIPTS_DIRNAME,
    `${transactionId}${suffix}.json`
  )
}

/** Absent returns null; mismatched request receipts throw. */
export function readOCCdStopReceipt<T extends { request: OCCdManagedStopRequest }>(
  request: OCCdManagedStopRequest,
  kind: ReceiptKind,
  schema: z.ZodType<T>
): T | null {
  const path = occdStopReceiptPath(request, kind)
  try {
    if (!lstatSync(path).isFile()) {
      throw new Error('occd_stop_receipt_unverifiable')
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
  const receipt = schema.parse(
    JSON.parse(readNodeFileSyncWithinLimit(path, RECEIPT_MAX_BYTES).buffer.toString('utf8'))
  )
  if (occdManagedStopRequestKey(receipt.request) !== occdManagedStopRequestKey(request)) {
    throw new Error('occd_stop_receipt_mismatch')
  }
  return receipt
}

function writeReceipt(request: OCCdManagedStopRequest, kind: ReceiptKind, receipt: unknown): void {
  if (!writeDurableSecureJsonFile(occdStopReceiptPath(request, kind), receipt)) {
    throw new Error('occd_stop_receipt_permissions_unconfirmed')
  }
}

export function readOCCdCompletedStopReceipt(
  request: OCCdManagedStopRequest
): OCCdCompletedStopReceipt | null {
  return readOCCdStopReceipt(request, 'completed', OCCdCompletedStopReceiptSchema)
}

/** Persist only after proven exit and fsync even existing receipts.
 * Missing retirement records remain unverifiable. */
export function persistOCCdCompletedStopReceipt(
  request: OCCdManagedStopRequest,
  exitedAt: Date
): OCCdCompletedStopReceipt {
  const parsed = OCCdManagedStopRequestSchema.parse(request)
  const retirement = parsed.retireIdleDaemon
    ? (readOCCdDaemonRetirementRecord(parsed)?.retirement ?? 'unverifiable')
    : undefined
  const receipt = readOCCdCompletedStopReceipt(parsed) ?? {
    schemaVersion: 1 as const,
    kind: 'occd_managed_stop_completed' as const,
    request: parsed,
    exitedAt: exitedAt.toISOString(),
    ...(retirement ? { retirement } : {})
  }
  writeReceipt(parsed, 'completed', receipt)
  return receipt
}

export function readOCCdDaemonRetirementRecord(
  request: OCCdManagedStopRequest
): OCCdDaemonRetirementRecord | null {
  return readOCCdStopReceipt(request, 'retirement', OCCdDaemonRetirementRecordSchema)
}

export function persistOCCdDaemonRetirementRecord(
  request: OCCdManagedStopRequest,
  outcome: Pick<OCCdDaemonRetirementRecord, 'retirement' | 'liveSessions' | 'reason'>
): void {
  writeReceipt(request, 'retirement', {
    schemaVersion: 1,
    kind: 'occd_managed_stop_retirement',
    request: OCCdManagedStopRequestSchema.parse(request),
    // Name fields explicitly; extra in-process fields would fail the strict schema.
    retirement: outcome.retirement,
    liveSessions: outcome.liveSessions,
    reason: outcome.reason
  })
}
