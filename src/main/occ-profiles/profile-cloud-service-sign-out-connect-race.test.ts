import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  OCCCloudCapabilities,
  OCCCloudOrgSummary,
  OCCProfileCloudSummary
} from '../../shared/occ-profiles'

const {
  beginOCCCloudPkceFlowMock,
  exchangeOCCCloudAuthCodeMock,
  revokeOCCCloudSessionMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginOCCCloudPkceFlowMock: vi.fn(),
  exchangeOCCCloudAuthCodeMock: vi.fn(),
  revokeOCCCloudSessionMock: vi.fn(),
  safeStorageMock: {
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    isEncryptionAvailable: vi.fn(() => true)
  }
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath },
  safeStorage: safeStorageMock
}))

vi.mock('./profile-cloud-pkce', () => ({
  beginOCCCloudPkceFlow: beginOCCCloudPkceFlowMock
}))

vi.mock('./profile-cloud-client', () => ({
  createOCCCloudProfile: vi.fn(),
  exchangeOCCCloudAuthCode: exchangeOCCCloudAuthCodeMock,
  revokeOCCCloudSession: revokeOCCCloudSessionMock,
  selectOCCCloudOrg: vi.fn()
}))

import {
  connectCurrentOCCProfile,
  getCurrentOCCProfileAuthStatus,
  signOutCurrentOCCProfile
} from './profile-cloud-service'

const cloud: OCCProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const laterCloud: OCCProfileCloudSummary = {
  ...cloud,
  cloudProfileId: 'cloud-profile-2',
  email: 'ada@example.com'
}

const capabilities: OCCCloudCapabilities = { flags: { share: true }, refreshedAt: 11 }
const organizations: OCCCloudOrgSummary[] = [{ orgId: 'org-1', name: 'Acme', role: 'Admin' }]

describe('OCC cloud sign-out vs newer connect', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'occ-cloud-sign-out-connect-'))
    beginOCCCloudPkceFlowMock.mockReset()
    exchangeOCCCloudAuthCodeMock.mockReset()
    revokeOCCCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.stubEnv('OCC_CLOUD_API_URL', 'https://occ-cloud.example')
    vi.stubEnv('OCC_CLOUD_CLIENT_ID', 'desktop-client')
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
      expiresAt: Date.now() + 3_600_000,
      cloud,
      organizations,
      capabilities
    })
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('keeps a newer connect that finishes while sign-out is still revoking', async () => {
    await expect(connectCurrentOCCProfile(userDataPath)).resolves.toMatchObject({
      status: 'connected'
    })
    let finishRevoke!: () => void
    revokeOCCCloudSessionMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRevoke = resolve
      })
    )
    const signingOut = signOutCurrentOCCProfile(userDataPath)
    exchangeOCCCloudAuthCodeMock.mockResolvedValue({
      accessToken: 'later-access',
      refreshToken: 'later-refresh',
      expiresAt: Date.now() + 3_600_000,
      cloud: laterCloud,
      organizations,
      capabilities
    })
    await expect(connectCurrentOCCProfile(userDataPath)).resolves.toMatchObject({
      status: 'connected'
    })
    expect(getCurrentOCCProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')
    finishRevoke()
    await expect(signingOut).resolves.toMatchObject({ status: 'signed-out' })
    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'connected',
      cloud: { email: 'ada@example.com' }
    })
  })
})
