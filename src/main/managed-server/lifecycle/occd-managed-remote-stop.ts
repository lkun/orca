// Readiness and instance-lock records must agree before the slot's own build requests a stop.
import { randomUUID } from 'node:crypto'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { selectOCCdSlotRuntimeCommand } from '../install/occd-remote-runtime'
import {
  parseOCCdReadinessWaitOutput,
  readOCCdReadinessNowCommand
} from '../install/occd-remote-readiness-wait'
import { execOCCdRemote } from '../install/occd-remote-runtime-control'
import { readBoundedOCCdRemoteRecord } from '../install/occd-remote-record-file'
import { occdSlotDir, type OCCdSlotOptions } from '../../ssh/occd-recovery-slot'
import { isWindowsRemoteHost, joinRemotePath } from '../../ssh/ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import {
  occdWindowsNodeCommandLine,
  occdWindowsSlotOpCommand,
  readOCCdWindowsEncodedAnswer
} from '../install/occd-remote-windows-node'
import { OCCD_WINDOWS_RUNTIME_MARKER } from '../host-state/occd-windows-host-script'
import { OCCD_LOCK_FILE_NAME, parseOCCdInstanceLockRecord } from '../../occd/occd-instance-lock'
import {
  OCCD_CANCEL_MANAGED_STOP_FLAG,
  OCCD_COMPLETE_MANAGED_STOP_FLAG,
  OCCD_MANAGED_STOP_REQUEST_FILE_FLAG,
  OCCD_STOP_REQUESTS_CAPABILITY,
  OCCdManagedStopCancellationSchema,
  OCCdManagedStopCompletionSchema,
  type OCCdManagedStopCancellation,
  type OCCdManagedStopCompletion,
  type OCCdManagedStopContext,
  type OCCdManagedStopRequest
} from '../../../shared/occd-stop-request'

const LOCK_RECORD_MAX_BYTES = 64 * 1024

export type OCCdManagedStopTarget =
  | { state: 'ready'; context: OCCdManagedStopContext }
  | { state: 'refused'; verdict: 'unverifiable'; code: string; reason: string }

function refused(code: string, reason: string): OCCdManagedStopTarget {
  return { state: 'refused', verdict: 'unverifiable', code, reason }
}

export async function readRemoteOCCdManagedStopTarget(
  options: OCCdSlotOptions,
  version: string
): Promise<OCCdManagedStopTarget> {
  const slotDir = occdSlotDir(options, version)
  const readiness = parseOCCdReadinessWaitOutput(
    options.host,
    await execOCCdRemote(options, readOCCdReadinessNowCommand(options.host, slotDir))
  )
  if (readiness.state !== 'ready' || !readiness.readiness.health) {
    return refused(
      'occd_managed_stop_readiness_unverifiable',
      `occd ${version} has no readable readiness record, so the running instance is unknown.`
    )
  }
  const { health, runtimeId } = readiness.readiness
  if (health.stopRequests !== OCCD_STOP_REQUESTS_CAPABILITY) {
    return refused(
      'occd_managed_stop_unsupported',
      `occd ${version} predates managed stop requests; it can only be stopped by signal.`
    )
  }
  const lockPath = joinRemotePath(options.host, options.userDataDir, OCCD_LOCK_FILE_NAME)
  const lockRead = await readBoundedOCCdRemoteRecord(options, lockPath, LOCK_RECORD_MAX_BYTES)
  const lock = lockRead.state === 'present' ? parseOCCdInstanceLockRecord(lockRead.raw) : null
  if (!lock || lock.pid !== health.pid || !runtimeId) {
    return refused(
      'occd_managed_stop_instance_unverifiable',
      `The instance lock does not name the occd ${version} that published readiness.`
    )
  }
  return {
    state: 'ready',
    context: {
      version,
      runtimeId,
      instance: {
        pid: lock.pid,
        startedAtMs: lock.startedAtMs,
        // Newer slots use boot/start ticks to avoid wall-clock drift; older readers drop them.
        ...(lock.linuxStartTicks && lock.bootId
          ? { linuxStartTicks: lock.linuxStartTicks, bootId: lock.bootId }
          : {}),
        nonce: lock.nonce,
        lockPath
      }
    }
  }
}

export async function completeRemoteOCCdManagedStop(
  options: OCCdSlotOptions,
  request: OCCdManagedStopRequest
): Promise<OCCdManagedStopCompletion> {
  return OCCdManagedStopCompletionSchema.parse(
    await runSlotCommand(options, request, OCCD_COMPLETE_MANAGED_STOP_FLAG)
  )
}

export async function cancelRemoteOCCdManagedStop(
  options: OCCdSlotOptions,
  request: OCCdManagedStopRequest
): Promise<OCCdManagedStopCancellation> {
  return OCCdManagedStopCancellationSchema.parse(
    await runSlotCommand(options, request, OCCD_CANCEL_MANAGED_STOP_FLAG)
  )
}

// The slot's own build owns its stop-request format.
async function runSlotCommand(
  options: OCCdSlotOptions,
  request: OCCdManagedStopRequest,
  flag: string
): Promise<unknown> {
  const slotDir = occdSlotDir(options, request.version)
  const entry = joinRemotePath(options.host, slotDir, 'occd.js')
  const output = isWindowsRemoteHost(options.host)
    ? await runWindowsSlotCommand(options, slotDir, entry, request, flag)
    : await execOCCdRemote(
        options,
        `${selectOCCdSlotRuntimeCommand(options.host, slotDir, options.nodePath)} && ` +
          `"$occd_runtime" ${quotePosixShell(entry)} ${flag} ${quotePosixShell(JSON.stringify(request))}`
      )
  const line = output
    .trim()
    .split('\n')
    .findLast((candidate) => candidate.trim().startsWith('{'))
  if (!line) {
    throw new Error('occd managed stop command returned no verifiable answer')
  }
  const parsed: unknown = JSON.parse(line)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('occd managed stop command returned no verifiable answer')
  }
  if (!('transactionId' in parsed) || parsed.transactionId !== request.transactionId) {
    throw new Error('occd managed stop command answered another transaction')
  }
  return parsed
}

// Stage JSON on Windows to avoid two command-line quoting layers.
async function runWindowsSlotCommand(
  options: OCCdSlotOptions,
  slotDir: string,
  entry: string,
  request: OCCdManagedStopRequest,
  flag: string
): Promise<string> {
  const runtime = readOCCdWindowsEncodedAnswer(
    await execOCCdRemote(
      options,
      occdWindowsSlotOpCommand(options.host, slotDir, 'slot-runtime', [slotDir])
    ),
    OCCD_WINDOWS_RUNTIME_MARKER
  )
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this occd slot needs.')
  }
  const staged = joinRemotePath(options.host, slotDir, `.occd-stop-command-${randomUUID()}.json`)
  let removeStaged = true
  try {
    await options.conn.writeFile(staged, JSON.stringify(request), {
      hostPlatform: options.host,
      signal: options.signal
    })
    return await execOCCdRemote(
      options,
      occdWindowsNodeCommandLine(runtime, [
        entry,
        flag,
        OCCD_MANAGED_STOP_REQUEST_FILE_FLAG,
        staged
      ])
    )
  } catch (error) {
    // Unconfirmed commands may still be reading the staged request.
    removeStaged = !isUnconfirmedSshCommandTermination(error)
    throw error
  } finally {
    if (removeStaged) {
      await execOCCdRemote(
        options,
        occdWindowsSlotOpCommand(options.host, slotDir, 'remove-file', [staged])
      ).catch(() => {})
    }
  }
}
