// Exclusive hard links arbitrate stop versus cancel; cancel cannot succeed once dispatch wins.
import { linkSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { writeDurableSecureJsonFile } from '../../shared/secure-storage/secure-file'
import {
  OCCdManagedStopDecisionSchema,
  OCCdManagedStopRequestSchema,
  type OCCdManagedStopDecision,
  type OCCdManagedStopRequest
} from '../../shared/occd-stop-request'
import { occdStopReceiptPath, readOCCdStopReceipt } from './occd-completed-stop-receipt'
import { hasErrorCode } from '../daemon/endpoint/identity/daemon-process-inspection'

type OCCdManagedStopDecisionValue = OCCdManagedStopDecision['decision']

export function readOCCdManagedStopDecision(
  request: OCCdManagedStopRequest
): OCCdManagedStopDecisionValue | null {
  return readOCCdStopReceipt(request, 'decision', OCCdManagedStopDecisionSchema)?.decision ?? null
}

export function claimOCCdManagedStopDecision(
  input: OCCdManagedStopRequest,
  decision: OCCdManagedStopDecisionValue
): OCCdManagedStopDecisionValue {
  const request = OCCdManagedStopRequestSchema.parse(input)
  const path = occdStopReceiptPath(request, 'decision')
  const staged = `${path}.${process.pid}.${randomUUID()}.staged`
  const record: OCCdManagedStopDecision = {
    schemaVersion: 1,
    kind: 'occd_managed_stop_decision',
    request,
    decision
  }
  if (!writeDurableSecureJsonFile(staged, record)) {
    rmSync(staged, { force: true })
    throw new Error('occd_managed_stop_decision_permissions_unconfirmed')
  }
  try {
    linkSync(staged, path)
    return decision
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) {
      throw error
    }
    const standing = readOCCdManagedStopDecision(request)
    if (!standing) {
      throw new Error('occd_managed_stop_decision_unverifiable')
    }
    return standing
  } finally {
    rmSync(staged, { force: true })
  }
}
