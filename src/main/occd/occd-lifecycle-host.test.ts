import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./occd-browser-startup', () => ({
  startOCCdBrowserProvider: () => ({ ready: Promise.resolve(), stop: async () => {} })
}))

import { OCCD_LOCK_FILE_NAME, readOCCdInstanceLockRecord } from './occd-instance-lock'
import { startOCCdWithHost } from './occd-lifecycle'
import { isDesktopBrowserBridgeHostEnabled } from '../runtime/desktop-browser-bridge/desktop-browser-bridge-registry'
import { OCCD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/occd-managed-launch-env'

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
  it('names the instance a managed stop must address, and releases its lock on a clean stop', async () => {
    const root = dataRoot()
    const handle = await startOCCdWithHost(
      root,
      async () => ({}),
      () => {}
    )
    expect(readOCCdInstanceLockRecord(handle.instance.lockPath)).toMatchObject({
      pid: handle.instance.pid,
      nonce: handle.instance.nonce
    })
    await handle.stop()
    expect(existsSync(join(root, OCCD_LOCK_FILE_NAME))).toBe(false)
  })

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

  it('keeps the instance lock when a quit handler fails', async () => {
    const root = dataRoot()
    const handle = await startOCCdWithHost(
      root,
      async () => ({}),
      () => {
        throw new AggregateError([new Error('handler')], 'occd_quit_handlers_failed')
      }
    )
    await expect(handle.stop()).rejects.toThrow('occd_quit_handlers_failed')
    expect(existsSync(join(root, OCCD_LOCK_FILE_NAME))).toBe(true)
  })

  it.each([
    ['a managed launch', { [OCCD_MANAGED_ACTIVATION_ROOT_ENV]: '/home/me/.occ-server' }, true],
    ['a server the user started', {}, false]
  ])('takes desktop browser bridge commands only for %s', async (_name, env, expected) => {
    vi.stubEnv(OCCD_MANAGED_ACTIVATION_ROOT_ENV, env[OCCD_MANAGED_ACTIVATION_ROOT_ENV] ?? '')
    try {
      const handle = await startOCCdWithHost(
        dataRoot(),
        async () => ({}),
        () => {}
      )
      expect(isDesktopBrowserBridgeHostEnabled()).toBe(expected)
      await handle.stop()
      expect(isDesktopBrowserBridgeHostEnabled()).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
