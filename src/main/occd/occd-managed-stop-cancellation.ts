import { rmSync } from 'node:fs'
import type {
  OCCdManagedStopCancellation,
  OCCdManagedStopRequest
} from '../../shared/occd-stop-request'
import { claimOCCdManagedStopDecision } from './occd-managed-stop-decision'
import {
  occdManagedStopRequestPath,
  readOCCdManagedStopRequest
} from './occd-managed-stop-request'

/** Dispatched stops cannot be canceled; their completion verdict remains authoritative. */
export function cancelOCCdManagedStop(
  request: OCCdManagedStopRequest
): OCCdManagedStopCancellation['outcome'] {
  const outcome = claimOCCdManagedStopDecision(request, 'canceled')
  if (outcome === 'canceled') {
    withdrawOCCdManagedStopRequest(request)
  }
  return outcome
}

export function withdrawOCCdManagedStopRequest(request: OCCdManagedStopRequest): void {
  const path = occdManagedStopRequestPath(request.instance)
  try {
    if (readOCCdManagedStopRequest(path).transactionId === request.transactionId) {
      rmSync(path, { force: true })
    }
  } catch {
    // The persisted decision fences this transaction even if its request is gone.
  }
}
