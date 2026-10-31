// Resumed stale holders must prove their generation on-host before every step, preventing writes or release under a successor's fence.
import { AsyncLocalStorage } from 'node:async_hooks'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { isSshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'

export const OCCD_FENCE_OWNER_FILENAME = '.occ-fence-owner'
export const OCCD_FENCE_LOST_MARKER = '__OCCD_FENCE_LOST__'
/** EX_TEMPFAIL: this superseded generation cannot retry its step. */
export const OCCD_FENCE_LOST_EXIT = 75

export type OCCdFence = { lockDir: string; token: string }

const scope = new AsyncLocalStorage<OCCdFence>()

export function runWithOCCdFence<T>(fence: OCCdFence, run: () => Promise<T>): Promise<T> {
  return scope.run(fence, run)
}

export function currentOCCdFence(): OCCdFence | null {
  return scope.getStore() ?? null
}

export class OCCdFenceLostError extends Error {
  constructor() {
    super(
      "This run's activation fence was taken over by another run, so it stopped before changing the host."
    )
    this.name = 'OCCdFenceLostError'
  }
}

export function posixOCCdFenceOwnedTest(fence: OCCdFence): string {
  const owner = quotePosixShell(
    `${fence.lockDir.replace(/\/+$/u, '')}/${OCCD_FENCE_OWNER_FILENAME}`
  )
  return `[ "$(cat ${owner} 2>/dev/null)" = ${quotePosixShell(fence.token)} ]`
}

export function posixOCCdFenceGuard(fence: OCCdFence): string {
  return `${posixOCCdFenceOwnedTest(fence)} || { echo ${OCCD_FENCE_LOST_MARKER}; exit ${OCCD_FENCE_LOST_EXIT}; };`
}

/** Use exit status and stdout; error messages quote commands containing the marker even when no guard failed. */
export function isOCCdFenceLost(error: unknown): boolean {
  if (!isSshCommandExitError(error)) {
    return false
  }
  // `powershell -Command` reports any nonzero native exit as 1.
  const exited = error.exitCode === OCCD_FENCE_LOST_EXIT || error.exitCode === 1
  return exited && error.stdout.trim().split(/\r?\n/u).at(-1) === OCCD_FENCE_LOST_MARKER
}
