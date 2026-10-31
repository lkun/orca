import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConnectCurrentOCCProfileResult,
  OCCProfileAuthStatus
} from '../../../../shared/occ-profiles'
import { createTestStore } from './store-test-helpers'

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}))

const localAuth: OCCProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: true,
  state: 'local',
  persistence: 'none'
}

const occProfilesApi = {
  connectCurrent: vi.fn()
}

function deferredConnect(): (result: ConnectCurrentOCCProfileResult) => void {
  let finish!: (result: ConnectCurrentOCCProfileResult) => void
  occProfilesApi.connectCurrent.mockReturnValueOnce(
    new Promise<ConnectCurrentOCCProfileResult>((resolve) => {
      finish = resolve
    })
  )
  return (result) => finish(result)
}

describe('occ profile sign-in timeout', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('window', {
      api: { occProfiles: occProfilesApi }
    })
  })

  it('reports a timeout only for the newest wait', async () => {
    const finishFirst = deferredConnect()
    const finishSecond = deferredConnect()
    const store = createTestStore()

    const first = store.getState().connectCurrentOCCProfile()
    const second = store.getState().connectCurrentOCCProfile()
    finishFirst({ status: 'cancelled', auth: localAuth })
    await first
    expect(toastErrorMock).not.toHaveBeenCalled()

    finishSecond({ status: 'timed-out', auth: localAuth })
    await second
    expect(toastErrorMock).toHaveBeenCalledOnce()
    expect(toastErrorMock).toHaveBeenCalledWith('Sign-in timed out')
  })

  it('stays silent when the user cancels in the browser', async () => {
    occProfilesApi.connectCurrent.mockResolvedValueOnce({ status: 'cancelled', auth: localAuth })
    const store = createTestStore()

    await store.getState().connectCurrentOCCProfile()

    expect(toastErrorMock).not.toHaveBeenCalled()
  })
})
