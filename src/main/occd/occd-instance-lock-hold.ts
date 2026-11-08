// Holding the lock means re-proving it on every heartbeat, not only at acquisition.
import { statSync, unlinkSync, utimesSync } from 'node:fs'
import { startOCCdLockHeartbeat } from './occd-lock-clone-machine'
import { readBoundedLockFile } from './occd-instance-lock-reclaim'
import {
  describeLockHolder,
  parseOCCdInstanceLockRecord,
  type OCCdLockRecord
} from './occd-instance-lock-record'
import type { OCCdUnexpectedExit } from '../../shared/occd-unexpected-exit'

export type OCCdInstanceLock = {
  readonly path: string
  readonly record: OCCdLockRecord
  readonly previousUnexpectedExit: OCCdUnexpectedExit | null
  release(): void
}

type OCCdLockBeat = 'held' | 'lost' | 'unproven'

function lockIsAbsent(lockPath: string): boolean {
  try {
    return !statSync(lockPath, { throwIfNoEntry: false })
  } catch {
    // Unstattable (e.g. a Windows delete-pending file) proves nothing; the next beat retries.
    return false
  }
}

/** Re-assert ownership: a removed lock lets the next starter in, so re-publish it or yield to its new holder. */
function beatOCCdInstanceLock(
  lockPath: string,
  record: OCCdLockRecord,
  publish: () => boolean
): OCCdLockBeat {
  let current = readBoundedLockFile(lockPath)
  if (current === null && lockIsAbsent(lockPath)) {
    try {
      if (publish()) {
        console.warn(
          `[occd] The instance lock ${lockPath} was removed while occd ran; restored it.`
        )
        return 'held'
      }
    } catch (error) {
      console.warn('[occd] could not restore the removed instance lock:', error)
      return 'unproven'
    }
    // Another starter published between the read and the restore.
    current = readBoundedLockFile(lockPath)
  }
  const holder = parseOCCdInstanceLockRecord(current ?? '')
  if (!holder) {
    // Starters refuse unreadable records, and torn ones show up as a new holder by the next beat.
    console.warn(`[occd] could not read the instance lock ${lockPath} to confirm ownership`)
    return 'unproven'
  }
  if (holder.nonce !== record.nonce) {
    console.error(
      `[occd] ${describeLockHolder(holder)} (pid ${holder.pid}) took over the instance lock ` +
        `${lockPath}.`
    )
    return 'lost'
  }
  try {
    const now = new Date()
    utimesSync(lockPath, now, now)
  } catch (error) {
    // A stalled heartbeat lets a machine sharing this machine-id take the lock.
    console.warn('[occd] could not refresh the instance lock heartbeat:', error)
  }
  return 'held'
}

export function holdOCCdInstanceLock(
  lockPath: string,
  record: OCCdLockRecord,
  publish: () => boolean,
  {
    previousUnexpectedExit,
    onExclusivityLost
  }: { previousUnexpectedExit: OCCdUnexpectedExit | null; onExclusivityLost: () => void }
): OCCdInstanceLock {
  let released = false
  const stopHeartbeat = startOCCdLockHeartbeat(() => {
    if (beatOCCdInstanceLock(lockPath, record, publish) === 'lost') {
      stopHeartbeat()
      onExclusivityLost()
    }
  })
  return {
    path: lockPath,
    record,
    previousUnexpectedExit,
    release: () => {
      if (released) {
        return
      }
      released = true
      stopHeartbeat()
      // Re-read ownership before unlinking so a successor’s live runtime cannot be unlocked.
      const current = parseOCCdInstanceLockRecord(readBoundedLockFile(lockPath) ?? '')
      if (!current || current.nonce !== record.nonce) {
        return
      }
      try {
        unlinkSync(lockPath)
      } catch {
        // Dead-PID leftovers can be reclaimed on the next start.
      }
    }
  }
}
