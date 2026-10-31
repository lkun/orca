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
  refreshOCCCloudCapabilitiesMock,
  refreshOCCCloudSessionMock,
  OCCCloudRequestErrorMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginOCCCloudPkceFlowMock: vi.fn(),
  createOCCCloudProfileMock: vi.fn(),
  exchangeOCCCloudAuthCodeMock: vi.fn(),
  refreshOCCCloudCapabilitiesMock: vi.fn(),
  refreshOCCCloudSessionMock: vi.fn(),
  OCCCloudRequestErrorMock: class OCCCloudRequestError extends Error {
    constructor(public readonly statusCode: number) {
      super(`occ_cloud_request_failed_${statusCode}`)
      this.name = 'OCCCloudRequestError'
    }
  },
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
  OCCCloudRequestError: OCCCloudRequestErrorMock,
  isAmbiguousCloudRequestFailure: (error: unknown) => !(error instanceof OCCCloudRequestErrorMock),
  createOCCCloudProfile: createOCCCloudProfileMock,
  exchangeOCCCloudAuthCode: exchangeOCCCloudAuthCodeMock,
  refreshOCCCloudCapabilities: refreshOCCCloudCapabilitiesMock,
  refreshOCCCloudSession: refreshOCCCloudSessionMock,
  revokeOCCCloudSession: vi.fn(),
  selectOCCCloudOrg: vi.fn()
}))

import {
  connectCurrentOCCProfile,
  createCloudLinkedOCCProfile,
  getCurrentOCCProfileAuthStatus,
  refreshCurrentOCCProfileAuth
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

function futureExpiresAt(): number {
  return Date.now() + 3_600_000
}

function configureCloudEnv(): void {
  vi.stubEnv('OCC_CLOUD_API_URL', 'https://occ-cloud.example')
  vi.stubEnv('OCC_CLOUD_CLIENT_ID', 'desktop-client')
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

describe('OCC cloud profile service session refresh', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'occ-cloud-service-refresh-'))
    beginOCCCloudPkceFlowMock.mockReset()
    createOCCCloudProfileMock.mockReset()
    exchangeOCCCloudAuthCodeMock.mockReset()
    refreshOCCCloudCapabilitiesMock.mockReset()
    refreshOCCCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.unstubAllEnvs()
    vi.stubEnv('OCC_CLOUD_API_URL', '')
    vi.stubEnv('OCC_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('refreshes an expired access token before creating cloud profiles', async () => {
    configureCloudEnv()
    mockSuccessfulConnect(Date.now() - 1_000)
    await connectCurrentOCCProfile(userDataPath)
    refreshOCCCloudSessionMock.mockResolvedValue({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: cloudSummary,
      organizations,
      capabilities
    } satisfies OCCCloudSessionExchangeResponse)
    createOCCCloudProfileMock.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: {
        ...cloudSummary,
        cloudProfileId: 'cloud-profile-2',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      },
      organizations,
      capabilities
    } satisfies OCCCloudSessionExchangeResponse)

    const result = await createCloudLinkedOCCProfile(userDataPath, {
      orgId: 'org-1',
      name: 'Acme'
    })

    expect(result.status).toBe('created')
    expect(refreshOCCCloudSessionMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ refreshToken: 'refresh-token' })
    )
    expect(createOCCCloudProfileMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      { orgId: 'org-1', name: 'Acme' }
    )
  })

  it('refreshes capability flags for the connected profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentOCCProfile(userDataPath)
    refreshOCCCloudCapabilitiesMock.mockResolvedValue({
      capabilities: {
        flags: { share: false, team: true },
        refreshedAt: 25
      }
    })

    const result = await refreshCurrentOCCProfileAuth(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(refreshOCCCloudCapabilitiesMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' })
    )
    expect(getCurrentOCCProfileAuthStatus(userDataPath).capabilities).toEqual({
      flags: { share: false, team: true },
      refreshedAt: 25
    })
  })

  it('clears stale active org metadata when capability refresh returns no active org', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    exchangeOCCCloudAuthCodeMock.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: { ...cloudSummary, activeOrgId: 'org-1', activeOrgName: 'Acme' },
      organizations,
      capabilities
    } satisfies OCCCloudSessionExchangeResponse)
    await connectCurrentOCCProfile(userDataPath)
    refreshOCCCloudCapabilitiesMock.mockResolvedValue({
      cloud: cloudSummary,
      organizations: [],
      capabilities: {
        flags: { share: false },
        refreshedAt: 31
      }
    })

    const result = await refreshCurrentOCCProfileAuth(userDataPath)
    const status = getCurrentOCCProfileAuthStatus(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(status.cloud?.activeOrgId).toBeUndefined()
    expect(status.cloud?.activeOrgName).toBeUndefined()
    expect(status.organizations).toEqual([])
    expect(status.capabilities).toEqual({
      flags: { share: false },
      refreshedAt: 31
    })
  })

  it('requires reconnect when an expired refresh token is rejected', async () => {
    configureCloudEnv()
    mockSuccessfulConnect(Date.now() - 1_000)
    await connectCurrentOCCProfile(userDataPath)
    refreshOCCCloudSessionMock.mockRejectedValue(new OCCCloudRequestErrorMock(401))

    const result = await refreshCurrentOCCProfileAuth(userDataPath)

    expect(result.status).toBe('reconnect-required')
    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'reconnect-required',
      persistence: 'none',
      cloud: cloudSummary
    })
  })
})
