import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import {
  OCCD_MANAGED_STOP_REQUEST_MAX_BYTES,
  OCCD_MANAGED_STOP_REQUEST_PREFIX,
  OCCdManagedStopRequestSchema,
  type OCCdManagedStopContext,
  type OCCdManagedStopInstance,
  type OCCdManagedStopRequest
} from '../../shared/occd-stop-request'
import { readOCCdInstanceLockRecord, type OCCdLockRecord } from './occd-instance-lock'

/** Nonce-scoped paths prevent requests from addressing a previous instance. */
export function occdManagedStopRequestPath(instance: OCCdManagedStopInstance): string {
  const digest = createHash('sha256').update(instance.nonce).digest('hex')
  return join(dirname(instance.lockPath), `${OCCD_MANAGED_STOP_REQUEST_PREFIX}.${digest}`)
}

export function readOCCdManagedStopRequest(path: string): OCCdManagedStopRequest {
  if (!lstatSync(path).isFile()) {
    throw new Error('occd_managed_stop_request_not_regular_file')
  }
  const { buffer } = readNodeFileSyncWithinLimit(path, OCCD_MANAGED_STOP_REQUEST_MAX_BYTES)
  return OCCdManagedStopRequestSchema.parse(JSON.parse(buffer.toString('utf8')))
}

function sameOCCdManagedStopInstance(
  left: OCCdManagedStopInstance,
  right: Pick<OCCdManagedStopInstance, 'pid' | 'startedAtMs' | 'nonce'>
): boolean {
  return (
    left.pid === right.pid && left.startedAtMs === right.startedAtMs && left.nonce === right.nonce
  )
}

export function occdInstanceLockNames(instance: OCCdManagedStopInstance): boolean {
  return readOCCdInstanceLockNaming(instance) !== null
}

export function readOCCdInstanceLockNaming(
  instance: OCCdManagedStopInstance
): OCCdLockRecord | null {
  if (!lstatSync(instance.lockPath).isFile()) {
    return null
  }
  const record = readOCCdInstanceLockRecord(instance.lockPath)
  return record !== null && sameOCCdManagedStopInstance(instance, record) ? record : null
}

export function validateOCCdManagedStopRequest(
  context: OCCdManagedStopContext,
  requestPath: string
): OCCdManagedStopRequest {
  const request = readOCCdManagedStopRequest(requestPath)
  if (
    request.version !== context.version ||
    request.runtimeId !== context.runtimeId ||
    // Windows clients and servers may use different separators for the same lock.
    resolve(request.instance.lockPath) !== resolve(context.instance.lockPath) ||
    !sameOCCdManagedStopInstance(request.instance, context.instance)
  ) {
    throw new Error('occd_managed_stop_request_identity_mismatch')
  }
  if (!occdInstanceLockNames(context.instance)) {
    throw new Error('occd_managed_stop_instance_lock_changed')
  }
  return request
}
