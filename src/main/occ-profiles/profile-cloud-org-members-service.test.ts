import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { OCCCloudRequestError } from './profile-cloud-client'

const {
  runWithFreshOCCCloudSessionMock,
  listOCCCloudOrgMembersMock,
  inviteOCCCloudOrgMemberMock,
  revokeOCCCloudOrgInviteMock,
  changeOCCCloudOrgMemberRoleMock,
  removeOCCCloudOrgMemberMock
} = vi.hoisted(() => ({
  runWithFreshOCCCloudSessionMock: vi.fn(),
  listOCCCloudOrgMembersMock: vi.fn(),
  inviteOCCCloudOrgMemberMock: vi.fn(),
  revokeOCCCloudOrgInviteMock: vi.fn(),
  changeOCCCloudOrgMemberRoleMock: vi.fn(),
  removeOCCCloudOrgMemberMock: vi.fn()
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath }
}))

vi.mock('./profile-cloud-session-refresh', () => ({
  runWithFreshOCCCloudSessionMock,
  runWithFreshOCCCloudSession: runWithFreshOCCCloudSessionMock
}))

vi.mock('./profile-cloud-org-members-client', () => ({
  listOCCCloudOrgMembers: listOCCCloudOrgMembersMock,
  inviteOCCCloudOrgMember: inviteOCCCloudOrgMemberMock,
  revokeOCCCloudOrgInvite: revokeOCCCloudOrgInviteMock,
  changeOCCCloudOrgMemberRole: changeOCCCloudOrgMemberRoleMock,
  removeOCCCloudOrgMember: removeOCCCloudOrgMemberMock
}))

import {
  changeOCCProfileOrgMemberRole,
  inviteOCCProfileOrgMember,
  removeOCCProfileOrgMember,
  revokeOCCProfileOrgInvite
} from './profile-cloud-org-members-service'

const fakeSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 3_600_000,
  capabilities: { flags: {}, refreshedAt: 1 }
}

// Business 4xx return as values, so the session layer sees only thrown auth failures.
function runOperationDirectly(): void {
  runWithFreshOCCCloudSessionMock.mockImplementation(
    async (
      _config: unknown,
      _active: unknown,
      _path: unknown,
      op: (session: unknown) => unknown
    ) => ({
      status: 'ok',
      value: await op(fakeSession)
    })
  )
}

function configureCloudEnv(): void {
  vi.stubEnv('OCC_CLOUD_API_URL', 'https://occ-cloud.example')
  vi.stubEnv('OCC_CLOUD_CLIENT_ID', 'desktop-client')
}

describe('OCC cloud org members service (configured)', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'occ-org-members-'))
    runWithFreshOCCCloudSessionMock.mockReset()
    listOCCCloudOrgMembersMock.mockReset()
    inviteOCCCloudOrgMemberMock.mockReset()
    revokeOCCCloudOrgInviteMock.mockReset()
    changeOCCCloudOrgMemberRoleMock.mockReset()
    removeOCCCloudOrgMemberMock.mockReset()
    vi.unstubAllEnvs()
    vi.stubEnv('OCC_CLOUD_DEV_AUTH', '')
    vi.stubEnv('OCC_CLOUD_API_URL', '')
    vi.stubEnv('OCC_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('maps a 409 already_member invite conflict', async () => {
    configureCloudEnv()
    runOperationDirectly()
    inviteOCCCloudOrgMemberMock.mockRejectedValue(new OCCCloudRequestError(409, 'already_member'))

    await expect(
      inviteOCCProfileOrgMember(userDataPath, { orgId: 'org-1', email: 'a@b.com', role: 'member' })
    ).resolves.toEqual({ status: 'conflict', reason: 'already_member' })
  })

  it('maps a 403 role change to forbidden', async () => {
    configureCloudEnv()
    runOperationDirectly()
    changeOCCCloudOrgMemberRoleMock.mockRejectedValue(new OCCCloudRequestError(403))

    await expect(
      changeOCCProfileOrgMemberRole(userDataPath, {
        orgId: 'org-1',
        userId: 'user-2',
        role: 'admin'
      })
    ).resolves.toEqual({ status: 'forbidden' })
  })

  it('maps a 400 cannot_remove_self to an invalid result', async () => {
    configureCloudEnv()
    runOperationDirectly()
    removeOCCCloudOrgMemberMock.mockRejectedValue(
      new OCCCloudRequestError(400, 'cannot_remove_self')
    )

    await expect(
      removeOCCProfileOrgMember(userDataPath, { orgId: 'org-1', userId: 'user-1' })
    ).resolves.toEqual({ status: 'invalid', reason: 'cannot_remove_self' })
  })

  it('maps a 404 revoke to not-found', async () => {
    configureCloudEnv()
    runOperationDirectly()
    revokeOCCCloudOrgInviteMock.mockRejectedValue(new OCCCloudRequestError(404))

    await expect(
      revokeOCCProfileOrgInvite(userDataPath, { orgId: 'org-1', email: 'gone@b.com' })
    ).resolves.toEqual({ status: 'not-found' })
  })
})
