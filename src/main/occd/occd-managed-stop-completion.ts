// Request shutdown without signaling; only kernel identity, owner change or PID absence proves exit.
import { setTimeout as delay } from 'node:timers/promises'
import { writeDurableSecureJsonFile } from '../../shared/secure-storage/secure-file'
import {
  OCCdManagedStopRequestSchema,
  occdManagedStopRequestKey,
  type OCCdManagedStopInstance,
  type OCCdManagedStopRequest,
  type OCCdManagedStopVerdict
} from '../../shared/occd-stop-request'
import {
  compareOCCdProcessIdentity,
  recordedOCCdProcessIncarnation,
  type OCCdProcessIdentityReaders,
  type OCCdRecordedIdentity
} from './occd-process-start-time'
import {
  hasErrorCode,
  inspectProcessSignal
} from '../daemon/endpoint/identity/daemon-process-inspection'
import { persistOCCdCompletedStopReceipt } from './occd-completed-stop-receipt'
import { readOCCdManagedStopDecision } from './occd-managed-stop-decision'
import { withdrawOCCdManagedStopRequest } from './occd-managed-stop-cancellation'
import {
  occdInstanceLockNames,
  occdManagedStopRequestPath,
  readOCCdInstanceLockNaming,
  readOCCdManagedStopRequest
} from './occd-managed-stop-request'
import {
  OCCD_STOP_COMPLETION_POLL_ATTEMPTS,
  OCCD_STOP_COMPLETION_POLL_MS
} from './occd-stop-deadlines'

type OCCdProcessProbe = (pid: number) => 'alive' | 'missing' | 'unverifiable'

export type OCCdManagedStopCompletionOptions = OCCdProcessIdentityReaders & {
  probeProcess?: OCCdProcessProbe
  sleep?: () => Promise<void>
  attempts?: number
  now?: () => Date
}

function defaultProbe(pid: number): ReturnType<OCCdProcessProbe> {
  const signal = inspectProcessSignal(pid)
  // EPERM proves some process holds the PID; it cannot prove ours exited.
  return signal === 'occupied' ? 'alive' : signal === 'missing' ? 'missing' : 'unverifiable'
}

function observeInstance(
  instance: OCCdManagedStopInstance,
  recorded: OCCdRecordedIdentity,
  options: OCCdManagedStopCompletionOptions
): OCCdManagedStopVerdict {
  const probe = (options.probeProcess ?? defaultProbe)(instance.pid)
  if (probe !== 'alive') {
    return probe === 'missing' ? 'exited' : 'unverifiable'
  }
  // Wall-clock drift alone cannot prove PID reuse.
  const identity = compareOCCdProcessIdentity(instance.pid, recorded, options)
  return identity === 'differs' ? 'exited' : identity === 'unproven' ? 'unverifiable' : 'live'
}

/** Recover incarnation data from the lock for older clients that omit it. */
function recordedIdentity(instance: OCCdManagedStopInstance): OCCdRecordedIdentity {
  if (recordedOCCdProcessIncarnation(instance)) {
    return instance
  }
  let record: OCCdRecordedIdentity | null = null
  try {
    record = readOCCdInstanceLockNaming(instance)
  } catch {
    return instance
  }
  if (!record) {
    return instance
  }
  return { ...instance, ...recordedOCCdProcessIncarnation(record), identity: record.identity }
}

export async function completeOCCdManagedStop(
  input: OCCdManagedStopRequest,
  options: OCCdManagedStopCompletionOptions = {}
): Promise<OCCdManagedStopVerdict> {
  const request = OCCdManagedStopRequestSchema.parse(input)
  const attempts = options.attempts ?? OCCD_STOP_COMPLETION_POLL_ATTEMPTS
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 240) {
    throw new Error('occd_managed_stop_invalid_attempts')
  }
  const completed = (): 'exited' => {
    persistOCCdCompletedStopReceipt(request, (options.now ?? (() => new Date()))())
    return 'exited'
  }
  const recorded = recordedIdentity(request.instance)
  let verdict = observeInstance(request.instance, recorded, options)
  if (verdict !== 'live') {
    return verdict === 'exited' ? completed() : verdict
  }
  if (!lockStillNamesInstance(request.instance)) {
    // A live process that relinquished its lock is no longer ours to address.
    return 'unverifiable'
  }
  if (readOCCdManagedStopDecision(request) === 'canceled') {
    return 'live'
  }
  const requestPath = occdManagedStopRequestPath(request.instance)
  if (!existingRequestMatches(requestPath, request)) {
    return 'unverifiable'
  }
  if (!writeDurableSecureJsonFile(requestPath, request)) {
    throw new Error('occd_managed_stop_request_permissions_unconfirmed')
  }
  // A cancel between the first check and write had no request file to remove.
  if (readOCCdManagedStopDecision(request) === 'canceled') {
    withdrawOCCdManagedStopRequest(request)
    return 'live'
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    await (options.sleep ?? (() => delay(OCCD_STOP_COMPLETION_POLL_MS)))()
    verdict = observeInstance(request.instance, recorded, options)
    if (verdict !== 'live') {
      return verdict === 'exited' ? completed() : verdict
    }
  }
  return 'live'
}

function lockStillNamesInstance(instance: OCCdManagedStopInstance): boolean {
  try {
    return occdInstanceLockNames(instance)
  } catch {
    return false
  }
}

function existingRequestMatches(path: string, request: OCCdManagedStopRequest): boolean {
  try {
    return (
      occdManagedStopRequestKey(readOCCdManagedStopRequest(path)) ===
      occdManagedStopRequestKey(request)
    )
  } catch (error) {
    return hasErrorCode(error, 'ENOENT')
  }
}
