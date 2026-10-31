import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), on: vi.fn() } }))

const EXTENSION = 'a'.repeat(32)
const extension = { id: EXTENSION, version: '1.0' }
const userData = mkdtempSync(join(tmpdir(), 'occ-extension-occ-profiles-'))

afterEach(() => {
  vi.resetModules()
})

/** One launch of OCC as the given OCC profile, with fresh store singletons. */
async function openStoresAs(occProfileId: string) {
  const { configureBrowserExtensionProfileDataDirectory } =
    await import('./browser-extension-profile-data-directory')
  configureBrowserExtensionProfileDataDirectory(join(userData, 'profiles', occProfileId))
  const sync = (
    await import('./browser-extension-sync-storage-store')
  ).getBrowserExtensionSyncStorageStore()
  const state = (
    await import('./browser-extension-profile-state-store')
  ).getBrowserExtensionProfileStateStore()
  const dnr = await import('./browser-extension-dnr-store')
  return { sync, state, dnr }
}

describe('browser extension data per OCC profile', () => {
  it('keeps one OCC profile’s "default" browser profile data from another', async () => {
    const personal = await openStoresAs('local-default')
    personal.sync.write('default', EXTENSION, { token: 'personal-secret' })
    personal.state.update('default', EXTENSION, (current) => ({
      ...current,
      grantedOrigins: ['https://personal.example/*']
    }))
    personal.dnr.updateBrowserExtensionDnrState('default', extension, {
      dynamicRules: [{ id: 1 }]
    })
    personal.sync.flush()
    personal.state.flush()
    personal.dnr.getBrowserExtensionDnrStore().flush()
    vi.resetModules()

    const work = await openStoresAs('work')
    expect(work.sync.read('default', EXTENSION)).toEqual({})
    expect(work.state.read('default', EXTENSION).grantedOrigins).toEqual([])
    expect(work.dnr.readBrowserExtensionDnrState('default', extension).dynamicRules).toEqual([])
    vi.resetModules()

    const personalAgain = await openStoresAs('local-default')
    expect(personalAgain.sync.read('default', EXTENSION)).toEqual({ token: 'personal-secret' })
    rmSync(userData, { recursive: true, force: true })
  })
})
