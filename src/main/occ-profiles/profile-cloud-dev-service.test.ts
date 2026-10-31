import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  app: {
    getPath: () => userDataPath
  },
  safeStorage: safeStorageMock
}))

vi.mock('./profile-cloud-pkce', () => ({
  beginOCCCloudPkceFlow: beginOCCCloudPkceFlowMock
}))

vi.mock('./profile-cloud-client', () => ({
  createOCCCloudProfile: vi.fn(),
  exchangeOCCCloudAuthCode: exchangeOCCCloudAuthCodeMock,
  refreshOCCCloudCapabilities: vi.fn(),
  refreshOCCCloudSession: vi.fn(),
  revokeOCCCloudSession: revokeOCCCloudSessionMock,
  selectOCCCloudOrg: vi.fn()
}))

import {
  connectCurrentOCCProfile,
  createCloudLinkedOCCProfile,
  getCurrentOCCProfileAuthStatus,
  selectCurrentOCCProfileOrg,
  signOutCurrentOCCProfile
} from './profile-cloud-service'

describe('OCC cloud dev auth service', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'occ-cloud-dev-auth-'))
    beginOCCCloudPkceFlowMock.mockReset()
    exchangeOCCCloudAuthCodeMock.mockReset()
    revokeOCCCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.unstubAllEnvs()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('OCC_CLOUD_DEV_AUTH', '1')
    vi.stubEnv('OCC_CLOUD_API_URL', '')
    vi.stubEnv('OCC_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('connects the active profile without PKCE or cloud endpoints', async () => {
    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local'
    })

    const result = await connectCurrentOCCProfile(userDataPath)

    expect(result.status).toBe('connected')
    expect(beginOCCCloudPkceFlowMock).not.toHaveBeenCalled()
    expect(exchangeOCCCloudAuthCodeMock).not.toHaveBeenCalled()
    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'connected',
      persistence: 'encrypted',
      cloud: {
        cloudProfileId: 'dev-cloud-local-default',
        email: 'dev@occ.local'
      },
      capabilities: {
        flags: expect.objectContaining({ 'share.create': true })
      }
    })
    expect(getCurrentOCCProfileAuthStatus(userDataPath).organizations).toHaveLength(2)
  })

  it('selects dev organizations and creates org-scoped cloud profiles locally', async () => {
    await connectCurrentOCCProfile(userDataPath)

    const selected = await selectCurrentOCCProfileOrg(userDataPath, 'dev-acme')
    const created = await createCloudLinkedOCCProfile(userDataPath, {
      orgId: 'dev-acme',
      name: 'Acme Dev'
    })

    expect(selected.status).toBe('selected')
    expect(getCurrentOCCProfileAuthStatus(userDataPath).cloud).toMatchObject({
      activeOrgId: 'dev-acme',
      activeOrgName: 'Acme Dev'
    })
    expect(created.status).toBe('created')
    if (created.status === 'created') {
      expect(created.profile).toMatchObject({
        name: 'Acme Dev',
        kind: 'cloud-linked',
        cloud: expect.objectContaining({
          activeOrgId: 'dev-acme',
          activeOrgName: 'Acme Dev'
        })
      })
    }
  })

  it('signs out locally without calling the cloud logout endpoint', async () => {
    await connectCurrentOCCProfile(userDataPath)
    const regionCache = join(userDataPath, 'occ-relay-region-preference.json')
    writeFileSync(regionCache, '{}')

    const result = await signOutCurrentOCCProfile(userDataPath)

    expect(result.status).toBe('signed-out')
    expect(existsSync(regionCache)).toBe(false)
    expect(revokeOCCCloudSessionMock).not.toHaveBeenCalled()
    expect(getCurrentOCCProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local',
      persistence: 'none'
    })
  })
})
