import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./occd-browser-startup', () => ({
  startOCCdBrowserProvider: () => ({ ready: Promise.resolve(), stop: async () => {} })
}))

import { OCCD_LOCK_FILE_NAME } from './occd-instance-lock'
import { startOCCdWithHost } from './occd-lifecycle'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function dataRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'occd-lifecycle-host-'))
  roots.push(root)
  return root
}

describe('startOCCdWithHost', () => {
  it('keeps the instance lock when a runtime writer could not be stopped', async () => {
    const root = dataRoot()
    const failure = new Error('profile writer still running')
    const handle = await startOCCdWithHost(
      root,
      async (registerCleanup) => {
        registerCleanup(() => {
          throw failure
        })
        return {}
      },
      () => {}
    )
    await expect(handle.stop()).rejects.toBe(failure)
    expect(existsSync(join(root, OCCD_LOCK_FILE_NAME))).toBe(true)
  })
})
