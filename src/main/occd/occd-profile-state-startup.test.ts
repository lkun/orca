import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createProfileStateStoreForStartupMock,
  emitMock,
  ensureActiveOCCProfileMock,
  initOCCProfilePathsMock,
  initSshHostKeyStoreFileMock
} = vi.hoisted(() => ({
  createProfileStateStoreForStartupMock: vi.fn(),
  emitMock: vi.fn(),
  ensureActiveOCCProfileMock: vi.fn(),
  initOCCProfilePathsMock: vi.fn(),
  initSshHostKeyStoreFileMock: vi.fn()
}))

vi.mock('../persistence/profile-state/profile-state-startup-authority', () => ({
  createProfileStateStoreForStartup: createProfileStateStoreForStartupMock
}))
vi.mock('../occ-profiles/profile-index-store', () => ({
  ensureActiveOCCProfile: ensureActiveOCCProfileMock,
  initOCCProfilePaths: initOCCProfilePathsMock
}))
vi.mock('../ssh/ssh-host-key-store', () => ({
  initSshHostKeyStoreFile: initSshHostKeyStoreFileMock
}))
vi.mock('./occd-profile-state-telemetry', () => ({
  emitOCCdProfileStateAuthoritySelected: emitMock
}))

const {
  createOCCdProfileStateStartup,
  occdProfileWriterIdleStopMs,
  WSL_HOST_PROFILE_WRITER_IDLE_STOP_MS
} = await import('./occd-profile-state-startup')

beforeEach(() => {
  vi.resetAllMocks()
  ensureActiveOCCProfileMock.mockReturnValue({
    dataFile: '/tmp/profile/occ-data.json',
    stateDatabaseFile: '/tmp/profile/profile-state.db',
    profile: { id: 'profile-1' }
  })
})

describe('occd profile-state startup', () => {
  it('selects the capable authority once and publishes bounded metadata', async () => {
    const store = { getSettings: vi.fn() }
    createProfileStateStoreForStartupMock.mockReturnValue({
      store,
      authority: { readSerializedState: vi.fn() },
      backend: 'sqlite',
      classification: 'json-only',
      migrated: true
    })

    const result = await createOCCdProfileStateStartup('/tmp/user-data')

    expect(initOCCProfilePathsMock).toHaveBeenCalledOnce()
    expect(ensureActiveOCCProfileMock).toHaveBeenCalledWith('/tmp/user-data')
    expect(initSshHostKeyStoreFileMock).toHaveBeenCalledWith('/tmp/profile/occ-data.json')

    expect(createProfileStateStoreForStartupMock).toHaveBeenCalledWith({
      userDataPath: '/tmp/user-data',
      dataFile: '/tmp/profile/occ-data.json',
      databaseFile: '/tmp/profile/profile-state.db',
      profileId: 'profile-1',
      runtime: 'occd',
      storageAuthority: 'runtime'
    })
    expect(result.store).toBe(store)
    expect(result.authority).toEqual({
      backend: 'sqlite',
      classification: 'json-only',
      authority_mode: 'sqlite-established',
      runtime: 'occd',
      migrated: true
    })
    expect(emitMock).toHaveBeenCalledWith(result.authority)
  })

  it('publishes nothing before the profile writer is ready', async () => {
    let refuse = (_error: Error) => {}
    createProfileStateStoreForStartupMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject
        })
    )
    const startup = createOCCdProfileStateStartup('/tmp/user-data')
    const failure = new Error('writer startup refused')
    const rejected = expect(startup).rejects.toBe(failure)
    expect(initSshHostKeyStoreFileMock).not.toHaveBeenCalled()
    expect(emitMock).not.toHaveBeenCalled()
    refuse(failure)
    await rejected
  })

  it('closes a ready writer if sidecar initialization fails', async () => {
    const store = { freezeWritesAsync: vi.fn(async () => {}) }
    createProfileStateStoreForStartupMock.mockResolvedValueOnce({
      store,
      backend: 'sqlite',
      classification: 'sqlite-only',
      migrated: false
    })
    const failure = new Error('sidecar initialization refused')
    initSshHostKeyStoreFileMock.mockImplementationOnce(() => {
      throw failure
    })
    await expect(createOCCdProfileStateStartup('/tmp/user-data')).rejects.toBe(failure)
    expect(store.freezeWritesAsync).toHaveBeenCalledOnce()
    expect(emitMock).not.toHaveBeenCalled()
  })
})

describe('occd profile writer idle stop', () => {
  it('stops an idle writer after a minute on a WSL host only', () => {
    expect(occdProfileWriterIdleStopMs(() => true)).toBe(WSL_HOST_PROFILE_WRITER_IDLE_STOP_MS)
    expect(WSL_HOST_PROFILE_WRITER_IDLE_STOP_MS).toBe(60_000)
    expect(occdProfileWriterIdleStopMs(() => false)).toBeUndefined()
  })
})
