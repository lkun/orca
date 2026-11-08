import type * as NewProfileStateModule from '../../occ-profiles/new-profile-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProfileStoragePaths from '../../occ-profiles/profile-storage-paths'
import type * as ProfileCloudService from '../../occ-profiles/profile-cloud-service'

const {
  handlers,
  appExitMock,
  appQuitMock,
  appRelaunchMock,
  relaunchAppMock,
  destroySystemTrayMock,
  createLocalOCCProfileMock,
  createCloudLinkedOCCProfileMock,
  getOCCProfileListStateMock,
  initializeNewOCCProfileStateMock,
  setActiveOCCProfileMock,
  transferOCCProfileProjectMock,
  hasOCCProfileStateDatabaseMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  appExitMock: vi.fn(),
  appQuitMock: vi.fn(),
  appRelaunchMock: vi.fn(),
  relaunchAppMock: vi.fn(),
  destroySystemTrayMock: vi.fn(),
  createLocalOCCProfileMock: vi.fn(),
  createCloudLinkedOCCProfileMock: vi.fn(),
  getOCCProfileListStateMock: vi.fn(),
  initializeNewOCCProfileStateMock: vi.fn(),
  setActiveOCCProfileMock: vi.fn(),
  transferOCCProfileProjectMock: vi.fn(),
  hasOCCProfileStateDatabaseMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    exit: appExitMock,
    quit: appQuitMock,
    relaunch: appRelaunchMock
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../../tray/system-tray', () => ({
  destroySystemTray: destroySystemTrayMock
}))

vi.mock('../../startup/quit/app-relaunch', () => ({
  relaunchApp: relaunchAppMock
}))

vi.mock('../../occ-profiles/profile-index-store', () => ({
  createLocalOCCProfile: createLocalOCCProfileMock,
  getOCCProfileListState: getOCCProfileListStateMock,
  initializeNewOCCProfileState: initializeNewOCCProfileStateMock,
  setActiveOCCProfile: setActiveOCCProfileMock
}))

vi.mock('../../occ-profiles/new-profile-state', async (importOriginal) => ({
  ...(await importOriginal<typeof NewProfileStateModule>()),
  initializeNewOCCProfileState: initializeNewOCCProfileStateMock
}))

vi.mock('../../occ-profiles/profile-cloud-service', async (importOriginal) => ({
  ...(await importOriginal<typeof ProfileCloudService>()),
  createCloudLinkedOCCProfile: createCloudLinkedOCCProfileMock
}))

function makeStoreMock(flushPendingOrThrowAsync = vi.fn()) {
  const freezeWrites = vi.fn()
  const resumeMaintenance = vi.fn(async () => {})
  return {
    flushPendingOrThrowAsync,
    freezeWrites,
    resumeMaintenance,
    beginProfileMaintenance: vi.fn(async (options: unknown) => {
      await flushPendingOrThrowAsync(options)
      freezeWrites()
      return { resume: resumeMaintenance }
    }),
    getSettings: () => ({})
  }
}

vi.mock('../../occ-profiles/profile-project-transfer', () => ({
  transferOCCProfileProject: transferOCCProfileProjectMock
}))

vi.mock('../../occ-profiles/profile-storage-paths', async (importOriginal) => ({
  ...(await importOriginal<typeof ProfileStoragePaths>()),
  hasOCCProfileStateDatabase: hasOCCProfileStateDatabaseMock
}))

import { registerOCCProfileHandlers } from './occ-profiles'
import { installFakeAppEnvironment } from '../../../../config/scripts/test-runtime/environment/vitest-host-ports-setup'

const ipcEvent = { sender: { isDestroyed: () => false, send: vi.fn() } }

describe('registerOCCProfileHandlers', () => {
  beforeEach(() => {
    // Reinstall AppEnvironment per test after global beforeEach resets its fake.
    installFakeAppEnvironment({ getPath: () => '/tmp/occ-user-data' })
    vi.useFakeTimers()
    handlers.clear()
    ipcEvent.sender.send.mockClear()
    appExitMock.mockReset()
    appQuitMock.mockReset()
    appRelaunchMock.mockReset()
    relaunchAppMock.mockReset()
    relaunchAppMock.mockImplementation(() => appRelaunchMock())
    destroySystemTrayMock.mockReset()
    createLocalOCCProfileMock.mockReset()
    createCloudLinkedOCCProfileMock.mockReset()
    getOCCProfileListStateMock.mockReset()
    initializeNewOCCProfileStateMock.mockReset()
    setActiveOCCProfileMock.mockReset()
    transferOCCProfileProjectMock.mockReset()
    hasOCCProfileStateDatabaseMock.mockReset().mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes the selected workspace for a newly created local profile', () => {
    const created = { profile: { id: 'local-work', name: 'Work' } }
    createLocalOCCProfileMock.mockReturnValue(created)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Profile creation uses only the mocked store methods.
    registerOCCProfileHandlers(makeStoreMock() as never)

    expect(handlers.get('occProfiles:createLocal')?.(ipcEvent, { name: 'Work' })).toBe(created)
    expect(initializeNewOCCProfileStateMock).toHaveBeenCalledWith('local-work', undefined)
  })

  it('initializes Home for a newly created cloud-linked profile', async () => {
    const created = {
      status: 'created',
      auth: { activeProfileId: 'local-default' },
      activeProfileId: 'local-default',
      profiles: [],
      profile: { id: 'cloud-1' }
    }
    createCloudLinkedOCCProfileMock.mockResolvedValue(created)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Profile creation uses only the mocked store methods.
    registerOCCProfileHandlers(makeStoreMock() as never)

    await expect(
      handlers.get('occProfiles:createCloudLinked')?.(ipcEvent, { orgId: 'org-1', name: 'Work' })
    ).resolves.toBe(created)
    expect(initializeNewOCCProfileStateMock).toHaveBeenCalledWith('cloud-1', undefined)
  })
})
