import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OCCCloudSignInProgress } from '../../../../shared/occ-profiles'
import { createTestStore } from '../../store/testing/app-store-test-fixture'

type TestStore = ReturnType<typeof createTestStore>

const { storeHolder } = vi.hoisted((): { storeHolder: { current: TestStore | null } } => ({
  storeHolder: { current: null }
}))

vi.mock('../../store', () => ({
  useAppStore: {
    getState: () => storeHolder.current?.getState(),
    setState: (partial: { occProfileSignInProgress: OCCCloudSignInProgress | null }) =>
      storeHolder.current?.setState(partial)
  }
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

import { registerOCCProfileAuthIpcBridge } from './occ-profile-auth-ipc-bridge'

describe('occ profile sign-in progress IPC bridge', () => {
  let emitProgress: (progress: OCCCloudSignInProgress | null) => void
  const snapshots: ((progress: OCCCloudSignInProgress | null) => void)[] = []
  const WAITING = { link: 'https://login.example/authorize?state=a' }

  beforeEach(() => {
    snapshots.length = 0
    storeHolder.current = createTestStore()
    vi.stubGlobal('window', {
      api: {
        occProfiles: {
          onSignInProgressChanged: (
            callback: (progress: OCCCloudSignInProgress | null) => void
          ) => {
            emitProgress = callback
            return () => {}
          },
          signInProgress: () =>
            new Promise<OCCCloudSignInProgress | null>((resolve) => {
              snapshots.push(resolve)
            })
        }
      }
    })
  })

  const progress = (): OCCCloudSignInProgress | null =>
    storeHolder.current?.getState().occProfileSignInProgress ?? null

  it('lets a newer change win over a late snapshot', async () => {
    registerOCCProfileAuthIpcBridge([])
    await vi.waitFor(() => expect(snapshots).toHaveLength(1))
    emitProgress(null)
    snapshots[0](WAITING)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(progress()).toBeNull()
  })
})
