import { uptime } from 'node:os'
import type { OCCdUnexpectedExit } from '../../shared/occd-unexpected-exit'
import type { OCCdLockRecord } from './occd-instance-lock'

/** A reclaimed occd lock from this boot means that run died; without boot evidence a reboot cannot be ruled out. */
export function reclaimedUnexpectedExit(
  holder: OCCdLockRecord,
  self: Pick<OCCdLockRecord, 'bootId'>,
  // Linux reads the kernel boot time; elsewhere the OS uptime gives it.
  bootStartedAtMs: number = Date.now() - uptime() * 1000
): OCCdUnexpectedExit | null {
  const sameBoot =
    holder.bootId && self.bootId
      ? holder.bootId === self.bootId
      : Date.parse(holder.acquiredAt) >= bootStartedAtMs
  return holder.role !== 'desktop' && sameBoot
    ? { pid: holder.pid, version: holder.version, acquiredAt: holder.acquiredAt }
    : null
}

let previousUnexpectedExit: OCCdUnexpectedExit | null = null
let runFailed = false

/** A fatal stop keeps the instance lock, so the next start reports this run as unexpected. */
export function markOCCdRunFailed(): void {
  runFailed = true
}

export function occdRunFailed(): boolean {
  return runFailed
}

/** Set once from the startup lock acquisition, before readiness publishes health. */
export function recordOCCdPreviousUnexpectedExit(exit: OCCdUnexpectedExit | null): void {
  previousUnexpectedExit = exit
}

export function occdPreviousUnexpectedExit(): OCCdUnexpectedExit | null {
  return previousUnexpectedExit
}
