import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  createCloudLinkedOCCProfileMock,
  connectCurrentOCCProfileMock,
  getCurrentOCCProfileAuthStatusMock,
  refreshCurrentOCCProfileAuthMock,
  selectCurrentOCCProfileOrgMock,
  signOutCurrentOCCProfileMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  createCloudLinkedOCCProfileMock: vi.fn(),
  connectCurrentOCCProfileMock: vi.fn(),
  getCurrentOCCProfileAuthStatusMock: vi.fn(),
  refreshCurrentOCCProfileAuthMock: vi.fn(),
  selectCurrentOCCProfileOrgMock: vi.fn(),
  signOutCurrentOCCProfileMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    relaunch: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../tray/system-tray', () => ({
  destroySystemTray: vi.fn()
}))

vi.mock('../occ-profiles/profile-index-store', () => ({
  createLocalOCCProfile: vi.fn(),
  getOCCProfileListState: vi.fn(),
  seedNewOCCProfileTelemetryConsent: vi.fn(),
  setActiveOCCProfile: vi.fn()
}))

vi.mock('../occ-profiles/profile-project-transfer', () => ({
  transferOCCProfileProject: vi.fn()
}))

vi.mock('../occ-profiles/profile-cloud-service', () => ({
  createCloudLinkedOCCProfile: createCloudLinkedOCCProfileMock,
  connectCurrentOCCProfile: connectCurrentOCCProfileMock,
  getCurrentOCCProfileAuthStatus: getCurrentOCCProfileAuthStatusMock,
  refreshCurrentOCCProfileAuth: refreshCurrentOCCProfileAuthMock,
  selectCurrentOCCProfileOrg: selectCurrentOCCProfileOrgMock,
  signOutCurrentOCCProfile: signOutCurrentOCCProfileMock
}))

import { registerOCCProfileHandlers } from './occ-profiles'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

describe('registerOCCProfileHandlers auth channels', () => {
  beforeEach(() => {
    // Reinstall AppEnvironment per test after global beforeEach resets its fake.
    installFakeAppEnvironment({ getPath: () => '/tmp/occ-user-data' })
    handlers.clear()
    createCloudLinkedOCCProfileMock.mockReset()
    connectCurrentOCCProfileMock.mockReset()
    getCurrentOCCProfileAuthStatusMock.mockReset()
    refreshCurrentOCCProfileAuthMock.mockReset()
    selectCurrentOCCProfileOrgMock.mockReset()
    signOutCurrentOCCProfileMock.mockReset()
  })

  it('returns auth status for the current profile', async () => {
    const status = {
      activeProfileId: 'local-default',
      configured: false,
      state: 'unconfigured',
      persistence: 'none'
    }
    getCurrentOCCProfileAuthStatusMock.mockReturnValue(status)
    registerOCCProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('occProfiles:authStatus')?.(null))).resolves.toBe(
      status
    )
    expect(getCurrentOCCProfileAuthStatusMock).toHaveBeenCalledWith('/tmp/occ-user-data')
  })

  it('connects and signs out the current profile through the cloud service', async () => {
    const connectResult = { status: 'unconfigured', auth: { activeProfileId: 'local-default' } }
    const signOutResult = { status: 'signed-out', auth: { activeProfileId: 'local-default' } }
    connectCurrentOCCProfileMock.mockResolvedValue(connectResult)
    signOutCurrentOCCProfileMock.mockResolvedValue(signOutResult)
    registerOCCProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(handlers.get('occProfiles:connectCurrent')?.(null))
    ).resolves.toBe(connectResult)
    await expect(
      Promise.resolve(handlers.get('occProfiles:signOutCurrent')?.(null))
    ).resolves.toBe(signOutResult)
    expect(connectCurrentOCCProfileMock).toHaveBeenCalledWith('/tmp/occ-user-data')
    expect(signOutCurrentOCCProfileMock).toHaveBeenCalledWith('/tmp/occ-user-data')
  })

  it('refreshes profile auth through the cloud service', async () => {
    const refreshResult = { status: 'refreshed', auth: { activeProfileId: 'local-default' } }
    refreshCurrentOCCProfileAuthMock.mockResolvedValue(refreshResult)
    registerOCCProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('occProfiles:refreshAuth')?.(null))).resolves.toBe(
      refreshResult
    )
    expect(refreshCurrentOCCProfileAuthMock).toHaveBeenCalledWith('/tmp/occ-user-data')
  })

  it('validates organization selection before calling the cloud service', async () => {
    const selectResult = { status: 'selected', auth: { activeProfileId: 'local-default' } }
    selectCurrentOCCProfileOrgMock.mockResolvedValue(selectResult)
    registerOCCProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(handlers.get('occProfiles:selectOrg')?.(null, { orgId: ' org-1 ' }))
    ).resolves.toBe(selectResult)
    expect(selectCurrentOCCProfileOrgMock).toHaveBeenCalledWith('/tmp/occ-user-data', 'org-1')

    await expect(
      Promise.resolve(handlers.get('occProfiles:selectOrg')?.(null, { orgId: ' ' }))
    ).rejects.toThrow('invalid_occ_profile_org_selection')
  })

  it('creates cloud-linked profiles with trimmed optional args', async () => {
    const createResult = {
      status: 'created',
      auth: { activeProfileId: 'local-default' },
      activeProfileId: 'local-default',
      profiles: [],
      profile: { id: 'cloud-1' }
    }
    createCloudLinkedOCCProfileMock.mockResolvedValue(createResult)
    registerOCCProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(
        handlers.get('occProfiles:createCloudLinked')?.(null, { orgId: ' org-1 ', name: ' Acme ' })
      )
    ).resolves.toBe(createResult)
    expect(createCloudLinkedOCCProfileMock).toHaveBeenCalledWith('/tmp/occ-user-data', {
      orgId: 'org-1',
      name: 'Acme'
    })
  })
})
