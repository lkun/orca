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
  selectOCCCloudOrgMock,
  OCCCloudRequestErrorMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginOCCCloudPkceFlowMock: vi.fn(),
  createOCCCloudProfileMock: vi.fn(),
  exchangeOCCCloudAuthCodeMock: vi.fn(),
  refreshOCCCloudCapabilitiesMock: vi.fn(),
  refreshOCCCloudSessionMock: vi.fn(),
  selectOCCCloudOrgMock: vi.fn(),
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
  selectOCCCloudOrg: selectOCCCloudOrgMock
}))

import {
  connectCurrentOCCProfile,
  createCloudLinkedOCCProfile,
  getCurrentOCCProfileAuthStatus,
  refreshCurrentOCCProfileAuth,
  selectCurrentOCCProfileOrg
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

function mockSuccessfulConnect(): void {
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
    expiresAt: futureExpiresAt(),
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies OCCCloudSessionExchangeResponse)
}

function mockSuccessfulSessionRefresh(): void {
  refreshOCCCloudSessionMock.mockResolvedValue({
    accessToken: 'rotated-access-token',
    refreshToken: 'rotated-refresh-token',
    expiresAt: futureExpiresAt(),
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies OCCCloudSessionExchangeResponse)
}

describe('OCC cloud profile auth-failure retry', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'occ-cloud-service-auth-retry-'))
    beginOCCCloudPkceFlowMock.mockReset()
    createOCCCloudProfileMock.mockReset()
    exchangeOCCCloudAuthCodeMock.mockReset()
    refreshOCCCloudCapabilitiesMock.mockReset()
    refreshOCCCloudSessionMock.mockReset()
    selectOCCCloudOrgMock.mockReset()
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

  it('refreshes and retries cloud profile creation after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentOCCProfile(userDataPath)
    createOCCCloudProfileMock
      .mockRejectedValueOnce(new OCCCloudRequestErrorMock(401))
      .mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: futureExpiresAt(),
        cloud: { ...cloudSummary, cloudProfileId: 'cloud-profile-2' },
        organizations,
        capabilities
      } satisfies OCCCloudSessionExchangeResponse)

    const result = await createCloudLinkedOCCProfile(userDataPath, { name: 'Acme' })

    expect(result.status).toBe('created')
    expect(createOCCCloudProfileMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      { name: 'Acme' }
    )
  })

  it('refreshes and retries capability refresh after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentOCCProfile(userDataPath)
    refreshOCCCloudCapabilitiesMock
      .mockRejectedValueOnce(new OCCCloudRequestErrorMock(403))
      .mockResolvedValue({
        capabilities: { flags: { share: false }, refreshedAt: 26 } satisfies OCCCloudCapabilities
      })

    const result = await refreshCurrentOCCProfileAuth(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(refreshOCCCloudCapabilitiesMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' })
    )
    expect(getCurrentOCCProfileAuthStatus(userDataPath).capabilities).toEqual({
      flags: { share: false },
      refreshedAt: 26
    })
  })

  it('requires reconnect when a retried capability refresh is still unauthorized', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentOCCProfile(userDataPath)
    refreshOCCCloudCapabilitiesMock
      .mockRejectedValueOnce(new OCCCloudRequestErrorMock(401))
      .mockRejectedValueOnce(new OCCCloudRequestErrorMock(401))

    const result = await refreshCurrentOCCProfileAuth(userDataPath)

    expect(result.status).toBe('reconnect-required')
    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'reconnect-required',
      persistence: 'none',
      cloud: cloudSummary
    })
  })

  it('refreshes and retries organization selection after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentOCCProfile(userDataPath)
    selectOCCCloudOrgMock
      .mockRejectedValueOnce(new OCCCloudRequestErrorMock(401))
      .mockResolvedValue({
        cloud: { ...cloudSummary, activeOrgId: 'org-1', activeOrgName: 'Acme' },
        organizations,
        capabilities
      })

    const result = await selectCurrentOCCProfileOrg(userDataPath, 'org-1')

    expect(result.status).toBe('selected')
    expect(selectOCCCloudOrgMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      'org-1'
    )
  })
})
