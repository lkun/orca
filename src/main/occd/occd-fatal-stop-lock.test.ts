import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./occd-browser-startup', () => ({
  startOCCdBrowserProvider: () => ({ ready: Promise.resolve(), stop: async () => {} })
}))

import { OCCD_LOCK_FILE_NAME } from './occd-instance-lock'
import { installOCCdShutdownSignals, startOCCdWithHost } from './occd-lifecycle'

const roots: string[] = []
afterEach(() => {
  // Drops the shutdown deadline timer so it cannot call the real process.exit later.
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('a fatal occd stop', () => {
  // A released lock reads as a clean exit, so a run that died of an uncaught exception would never count as a crash.
  it('keeps the instance lock so the next start reports the run as unexpected', async () => {
    const root = mkdtempSync(join(tmpdir(), 'occd-fatal-stop-'))
    roots.push(root)
    vi.spyOn(process, 'on').mockImplementation(() => process)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub only records the code; nothing after process.exit runs here.
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const handle = await startOCCdWithHost(
      root,
      async () => ({}),
      () => {}
    )

    vi.useFakeTimers()
    installOCCdShutdownSignals(() => handle.stop())('uncaught exception', undefined, 1)
    // Under fake timers waitFor advances the clock by its interval, far short of the deadline.
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1), { interval: 1 })
    expect(exit).toHaveBeenCalledOnce()
    expect(existsSync(join(root, OCCD_LOCK_FILE_NAME))).toBe(true)
  })
})
