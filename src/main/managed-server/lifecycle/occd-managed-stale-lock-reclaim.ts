// Let the active slot gather lock evidence and apply nonce-pinned confirmation; clients only relay it.
import { z } from 'zod'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  OCCD_RECLAIM_STALE_LOCK_FLAG,
  OCCD_STALE_LOCK_DATA_ROOT_FLAG,
  OCCD_STALE_LOCK_EXPECT_NONCE_FLAG
} from '../../../shared/occd-stale-lock-reclaim'
import type {
  OCCdManagedStaleLockReclaimRequest,
  OCCdManagedStaleLockReclaimResult
} from '../../../shared/occd-managed-runtime'
import {
  OCCD_LAUNCHER_FILENAME,
  OCCD_SERVER_ENTRY_FILENAME
} from '../../../shared/occd-artifacts'
import { withOCCdActivationLock } from '../activation/occd-activation-lock'
import { readOCCdActivationRecord } from '../activation/occd-activation-record-store'
import {
  followLaunchedServerPort,
  withManagedOCCdLifecycle
} from '../../ssh/occd-runtime-maintenance'
import { managedOCCdSlot, resolveLinkedOCCdContext } from './occd-managed-runtime-context'
import { selectOCCdSlotRuntimeCommand } from '../install/occd-remote-runtime'
import { execOCCdRemote } from '../install/occd-remote-runtime-control'
import { occdSlotDir, type OCCdSlotOptions } from '../../ssh/occd-recovery-slot'
import { joinRemotePath } from '../../ssh/ssh-remote-platform'
import { isSshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'
import { wakeStoppedManagedOCCd } from './occd-managed-wake'
import { OCCD_LOCK_FILE_NAME } from '../../occd/occd-instance-lock'
import { errorMessage } from '../../../shared/error-message'

const ReclaimStatusSchema = z.enum(['none', 'eligible', 'refused', 'reclaimed'])

// Unknown newer statuses map to no-answer rather than failing reply parsing.
const ReclaimAnswerSchema = z.object({
  status: z.string(),
  lockPath: z.string(),
  message: z.string(),
  evidence: z
    .object({
      pid: z.number(),
      host: z.string(),
      bootId: z.string(),
      currentBootId: z.string(),
      ageMinutes: z.number(),
      nonce: z.string().optional()
    })
    .optional()
})

const RECLAIM_UNSUPPORTED_SENTINEL = 'OCC_STALE_LOCK_RECLAIM_UNSUPPORTED'
const RECLAIM_UNPINNED_SENTINEL = 'OCC_STALE_LOCK_RECLAIM_UNPINNED'

type ReclaimAnswer = Omit<z.infer<typeof ReclaimAnswerSchema>, 'status'> & {
  status: z.infer<typeof ReclaimStatusSchema>
}

type SlotReclaim =
  | { status: 'answered'; answer: ReclaimAnswer }
  /** Slots without nonce pinning require manual reclamation. */
  | { status: 'unsupported' | 'unpinned' | 'no-answer' | 'busy'; message: string }

export function runManagedOCCdStaleLockReclaim(
  userDataPath: string,
  selector: string,
  request: OCCdManagedStaleLockReclaimRequest
): Promise<OCCdManagedStaleLockReclaimResult> {
  return withManagedOCCdLifecycle(userDataPath, selector, async ({ environment, deployment }) => {
    const context = await resolveLinkedOCCdContext(environment, deployment)
    if (context.host.os !== 'linux') {
      return unsupported('This host’s OCC server has no stale-lock recovery.')
    }
    const slot = managedOCCdSlot(context, deployment.remotePort)
    // Serialize reclamation with launch so wake cannot race lock removal.
    const ran = await withOCCdActivationLock(
      slot,
      () => runOnActiveSlot(slot, request),
      (): SlotReclaim => ({
        status: 'busy',
        message: 'An update, rollback or recovery holds this host; try again when it finishes.'
      })
    )
    if (ran.status === 'unsupported') {
      const lockPath = joinRemotePath(slot.host, slot.userDataDir, OCCD_LOCK_FILE_NAME)
      return { status: 'unsupported', message: ran.message, lockPath }
    }
    if (ran.status === 'unpinned') {
      return { status: 'unsupported', message: ran.message, reclaimWithoutPin: true }
    }
    if (ran.status !== 'answered') {
      return { status: ran.status, message: ran.message }
    }
    const { answer } = ran
    if (answer.status !== 'reclaimed') {
      return { ...answer, status: answer.status }
    }
    const reclaimed = {
      status: 'reclaimed',
      environmentId: environment.id,
      message: answer.message,
      lockPath: answer.lockPath,
      ...(answer.evidence ? { evidence: answer.evidence } : {})
    } as const
    const notRestarted = await restartAfterReclaim(userDataPath, environment.id, slot)
    return notRestarted ? { ...reclaimed, notRestarted } : reclaimed
  })
}

/** Preserve successful reclamation even if restart fails; return the restart warning. */
async function restartAfterReclaim(
  userDataPath: string,
  environmentId: string,
  slot: OCCdSlotOptions
): Promise<string | null> {
  try {
    const wake = await wakeStoppedManagedOCCd(slot)
    if (wake.outcome !== 'started' && wake.outcome !== 'serving') {
      return wake.outcome === 'recovery-refused'
        ? wake.reason
        : `The lock was cleared, but this host’s OCC server did not start (${wake.outcome}); reconnect to start it.`
    }
    await followLaunchedServerPort(userDataPath, environmentId)
    return null
  } catch (error) {
    // Still return a result so callers can reconnect and clear stale notes.
    return `The lock was cleared, but this host’s OCC server did not start: ${errorMessage(error)}`
  }
}

async function runOnActiveSlot(
  slot: OCCdSlotOptions,
  request: OCCdManagedStaleLockReclaimRequest
): Promise<SlotReclaim> {
  // Another client may change the active slot while this one waits for the lock.
  const active = (await readOCCdActivationRecord(slot)).active
  if (!active) {
    return { status: 'unsupported', message: 'This host has no activated OCC server.' }
  }
  const slotDir = occdSlotDir(slot, active)
  const entry = joinRemotePath(slot.host, slotDir, OCCD_LAUNCHER_FILENAME)
  const bundle = joinRemotePath(slot.host, slotDir, OCCD_SERVER_ENTRY_FILENAME)
  const confirm = request.yes
    ? ` ${OCCD_STALE_LOCK_EXPECT_NONCE_FLAG} ${quotePosixShell(request.expectNonce)} --yes`
    : ''
  // Check support first: old slots might start serving or reclaim an unapproved replacement lock.
  const command =
    `if grep -qF -- ${quotePosixShell(OCCD_STALE_LOCK_EXPECT_NONCE_FLAG)} ${quotePosixShell(bundle)} 2>/dev/null; then ` +
    `${selectOCCdSlotRuntimeCommand(slot.host, slotDir, '')} && ` +
    `"$occd_runtime" ${quotePosixShell(entry)} ${OCCD_RECLAIM_STALE_LOCK_FLAG} ` +
    `${OCCD_STALE_LOCK_DATA_ROOT_FLAG} ${quotePosixShell(slot.userDataDir)} --json${confirm}; ` +
    `elif grep -qF -- ${quotePosixShell(OCCD_RECLAIM_STALE_LOCK_FLAG)} ${quotePosixShell(bundle)} 2>/dev/null; then ` +
    `echo ${RECLAIM_UNPINNED_SENTINEL}; else echo ${RECLAIM_UNSUPPORTED_SENTINEL}; fi`
  let output: string
  try {
    output = await execOCCdRemote(slot, command)
  } catch (error) {
    // Non-reclaimed outcomes exit nonzero but still print structured replies.
    if (!isSshCommandExitError(error)) {
      throw error
    }
    output = error.stdout
  }
  const lines = output.split('\n').map((line) => line.trim())
  if (lines.includes(RECLAIM_UNSUPPORTED_SENTINEL)) {
    return unsupported('This host’s OCC server predates the stale-lock recovery.')
  }
  if (lines.includes(RECLAIM_UNPINNED_SENTINEL)) {
    return {
      status: 'unpinned',
      message: 'This host’s OCC server is too old for OCC to clear the lock from here.'
    }
  }
  const answer = parseReclaimAnswer(output)
  return answer
    ? { status: 'answered', answer }
    : {
        status: 'no-answer',
        message: 'This host’s OCC server gave no answer OCC understands to the stale-lock check.'
      }
}

function parseReclaimAnswer(output: string): ReclaimAnswer | null {
  const line = output
    .trim()
    .split('\n')
    .findLast((candidate) => candidate.trim().startsWith('{'))
  if (!line) {
    return null
  }
  try {
    const parsed = ReclaimAnswerSchema.safeParse(JSON.parse(line))
    const status = ReclaimStatusSchema.safeParse(parsed.data?.status)
    return parsed.success && status.success ? { ...parsed.data, status: status.data } : null
  } catch {
    return null
  }
}

function unsupported(message: string): { status: 'unsupported'; message: string } {
  return { status: 'unsupported', message }
}
