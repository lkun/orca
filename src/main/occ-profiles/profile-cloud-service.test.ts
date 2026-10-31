import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  OCCCloudCapabilities,
  OCCCloudOrgSummary,
  OCCProfileCloudSummary
} from '../../shared/occ-profiles'
import type { OCCCloudSessionExchangeResponse } from './profile-cloud-session-exchange'

const {
  beginOCCCloudPkceFlowMock,
  createOCCCloudProfileMock,
  exchangeOCCCloudAuthCodeMock,
  revokeOCCCloudSessionMock,
  selectOCCCloudOrgMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginOCCCloudPkceFlowMock: vi.fn(),
  createOCCCloudProfileMock: vi.fn(),
  exchangeOCCCloudAuthCodeMock: vi.fn(),
  revokeOCCCloudSessionMock: vi.fn(),
  selectOCCCloudOrgMock: vi.fn(),
  safeStorageMock: {
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    isEncryptionAvailable: vi.fn(() => true)
  }
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  },
  safeStorage: safeStorageMock
}))

vi.mock('./profile-cloud-pkce', () => ({
  beginOCCCloudPkceFlow: beginOCCCloudPkceFlowMock
}))

vi.mock('./profile-cloud-client', () => ({
  createOCCCloudProfile: createOCCCloudProfileMock,
  exchangeOCCCloudAuthCode: exchangeOCCCloudAuthCodeMock,
  revokeOCCCloudSession: revokeOCCCloudSessionMock,
  selectOCCCloudOrg: selectOCCCloudOrgMock
}))

import {
  connectCurrentOCCProfile,
  createCloudLinkedOCCProfile,
  getCurrentOCCProfileAuthStatus,
  selectCurrentOCCProfileOrg,
  signOutCurrentOCCProfile
} from './profile-cloud-service'

const cloudSummary: OCCProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const capabilities: OCCCloudCapabilities = {
  flags: { share: true },
  refreshedAt: 11
}

const organizations: OCCCloudOrgSummary[] = [
  { orgId: 'org-1', name: 'Acme', role: 'Admin' },
  { orgId: 'org-2', name: 'Personal' }
]

function configureCloudEnv(): void {
  vi.stubEnv('OCC_CLOUD_API_URL', 'https://occ-cloud.example')
  vi.stubEnv('OCC_CLOUD_CLIENT_ID', 'desktop-client')
}

function futureExpiresAt(): number {
  return Date.now() + 3_600_000
}

function mockSuccessfulConnect(expiresAt = futureExpiresAt()): void {
  beginOCCCloudPkceFlowMock.mockResolvedValue({
    code: 'auth-code',
    codeVerifier: 'code-verifier',
    nonce: 'nonce',
    redirectUri: 'http://127.0.0.1:4100/auth/callback',
    state: 'state'
  })
  exchangeOCCCloudAuthCodeMock.mockResolvedValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt,
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies OCCCloudSessionExchangeResponse)
}

describe('OCC cloud profile service', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'occ-cloud-service-'))
    beginOCCCloudPkceFlowMock.mockReset()
    createOCCCloudProfileMock.mockReset()
    exchangeOCCCloudAuthCodeMock.mockReset()
    revokeOCCCloudSessionMock.mockReset()
    selectOCCCloudOrgMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    revokeOCCCloudSessionMock.mockResolvedValue(undefined)
    vi.unstubAllEnvs()
    vi.stubEnv('OCC_CLOUD_API_URL', '')
    vi.stubEnv('OCC_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('reports local unconfigured auth without cloud setup', () => {
    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({
      activeProfileId: 'local-default',
      configured: false,
      state: 'unconfigured',
      persistence: 'none'
    })
  })

  it('connects the active local profile without replacing its local profile ID', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()

    const result = await connectCurrentOCCProfile(userDataPath)

    if (result.status !== 'connected') {
      throw new Error(`Expected connected result, got ${result.status}`)
    }
    expect(result.activeProfileId).toBe('local-default')
    expect(result.profiles[0]).toMatchObject({
      id: 'local-default',
      kind: 'cloud-linked',
      cloud: cloudSummary
    })
    expect(exchangeOCCCloudAuthCodeMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ localProfileId: 'local-default', nonce: 'nonce' })
    )
    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'connected',
      persistence: 'encrypted',
      cloud: cloudSummary,
      organizations,
      capabilities
    })
  })

  it('treats provider-denied sign-in as a cancelled connect attempt', async () => {
    configureCloudEnv()
    beginOCCCloudPkceFlowMock.mockRejectedValue(new Error('occ_cloud_auth_denied'))

    const result = await connectCurrentOCCProfile(userDataPath)

    expect(result.status).toBe('cancelled')
    expect(exchangeOCCCloudAuthCodeMock).not.toHaveBeenCalled()
    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'local',
      persistence: 'none'
    })
  })

  it('reports callback failures as failed instead of cancelled', async () => {
    configureCloudEnv()
    beginOCCCloudPkceFlowMock.mockRejectedValue(new Error('occ_cloud_auth_callback_failed'))

    const result = await connectCurrentOCCProfile(userDataPath)

    expect(result).toMatchObject({ status: 'failed', error: 'occ_cloud_auth_callback_failed' })
    expect(exchangeOCCCloudAuthCodeMock).not.toHaveBeenCalled()
    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({ state: 'local' })
  })

  it('does not report a saved cloud session as connected when cloud config is unavailable', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentOCCProfile(userDataPath)
    vi.stubEnv('OCC_CLOUD_API_URL', '')
    vi.stubEnv('OCC_CLOUD_CLIENT_ID', '')

    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({
      configured: false,
      state: 'unconfigured',
      persistence: 'encrypted',
      cloud: cloudSummary,
      setupMessage: 'OCC Cloud sign-in is not configured for this build.'
    })
    expect(getCurrentOCCProfileAuthStatus(userDataPath).organizations).toBeUndefined()
    expect(getCurrentOCCProfileAuthStatus(userDataPath).capabilities).toBeUndefined()
  })

  it('signs out by removing cloud metadata while keeping the local profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentOCCProfile(userDataPath)

    const result = await signOutCurrentOCCProfile(userDataPath)

    expect(result.status).toBe('signed-out')
    expect(result.activeProfileId).toBe('local-default')
    expect(result.profiles[0]).toMatchObject({ id: 'local-default', kind: 'local' })
    expect(result.profiles[0]?.cloud).toBeUndefined()
    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'local',
      persistence: 'none'
    })
    expect(revokeOCCCloudSessionMock).toHaveBeenCalledOnce()
  })

  it('creates a new empty cloud-linked profile with its own cloud session', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentOCCProfile(userDataPath)
    createOCCCloudProfileMock.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: 1000,
      cloud: {
        ...cloudSummary,
        cloudProfileId: 'cloud-profile-2',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      },
      organizations,
      capabilities: { flags: { share: true, team: true }, refreshedAt: 13 }
    } satisfies OCCCloudSessionExchangeResponse)

    const result = await createCloudLinkedOCCProfile(userDataPath, {
      orgId: 'org-1',
      name: 'Acme'
    })

    if (result.status !== 'created') {
      throw new Error(`Expected created result, got ${result.status}`)
    }
    expect(result.profile).toMatchObject({
      id: expect.stringMatching(/^cloud-/),
      name: 'Acme',
      kind: 'cloud-linked',
      cloud: expect.objectContaining({ cloudProfileId: 'cloud-profile-2' })
    })
    expect(createOCCCloudProfileMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' }),
      { orgId: 'org-1', name: 'Acme' }
    )
  })

  it('selects an organization for a connected profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentOCCProfile(userDataPath)
    const orgCloudSummary = {
      ...cloudSummary,
      activeOrgId: 'org-1',
      activeOrgName: 'Acme'
    }
    selectOCCCloudOrgMock.mockResolvedValue({
      cloud: orgCloudSummary,
      organizations,
      capabilities: { flags: { share: true, sso: true }, refreshedAt: 12 }
    })

    const result = await selectCurrentOCCProfileOrg(userDataPath, 'org-1')

    expect(result.status).toBe('selected')
    expect(selectOCCCloudOrgMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' }),
      'org-1'
    )
    expect(getCurrentOCCProfileAuthStatus(userDataPath).cloud).toMatchObject({
      activeOrgId: 'org-1',
      activeOrgName: 'Acme'
    })
    expect(getCurrentOCCProfileAuthStatus(userDataPath).organizations).toEqual(organizations)
  })
})
