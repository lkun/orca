import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OCCOrgMembersRoster } from '../../shared/occ-profiles'
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
  listOCCProfileOrgMembers,
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

const roster: OCCOrgMembersRoster = {
  members: [{ userId: 'user-1', email: 'nina@example.com', role: 'owner' }],
  pendingInvites: [],
  viewerRole: 'owner',
  canManageMembers: true
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

  it('reports unconfigured when cloud sign-in is not set up', async () => {
    await expect(listOCCProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'unconfigured'
    })
    expect(runWithFreshOCCCloudSessionMock).not.toHaveBeenCalled()
  })

  it('returns the roster from the client', async () => {
    configureCloudEnv()
    runOperationDirectly()
    listOCCCloudOrgMembersMock.mockResolvedValue(roster)

    await expect(listOCCProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'ok',
      roster
    })
    expect(listOCCCloudOrgMembersMock).toHaveBeenCalledWith(
      expect.any(Object),
      fakeSession,
      'org-1'
    )
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

  it('reports reconnect-required when the session layer cannot refresh', async () => {
    configureCloudEnv()
    runWithFreshOCCCloudSessionMock.mockResolvedValue({ status: 'reconnect-required' })

    await expect(listOCCProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'reconnect-required'
    })
  })
})

describe('OCC cloud org members service (dev auth)', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'occ-org-members-dev-'))
    runWithFreshOCCCloudSessionMock.mockReset()
    vi.unstubAllEnvs()
    vi.stubEnv('OCC_CLOUD_DEV_AUTH', '1')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('serves an in-memory roster the caller can manage', async () => {
    const result = await listOCCProfileOrgMembers(userDataPath, 'dev-list-org')
    if (result.status !== 'ok') {
      throw new Error(`Expected ok, got ${result.status}`)
    }
    expect(result.roster.canManageMembers).toBe(true)
    expect(result.roster.viewerRole).toBe('owner')
    expect(result.roster.members[0]).toMatchObject({ role: 'owner' })
    expect(result.roster.members.some((member) => member.userId === null)).toBe(true)
    expect(result.roster.pendingInvites.length).toBeGreaterThan(0)
    expect(runWithFreshOCCCloudSessionMock).not.toHaveBeenCalled()
  })

  it('mutates the dev roster across invite and revoke', async () => {
    const orgId = 'dev-mutate-org'
    await expect(
      inviteOCCProfileOrgMember(userDataPath, {
        orgId,
        email: 'fresh@occ.local',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'ok' })

    const afterInvite = await listOCCProfileOrgMembers(userDataPath, orgId)
    if (afterInvite.status !== 'ok') {
      throw new Error('expected ok')
    }
    expect(afterInvite.roster.pendingInvites.some((i) => i.email === 'fresh@occ.local')).toBe(true)

    await expect(
      inviteOCCProfileOrgMember(userDataPath, {
        orgId,
        email: 'fresh@occ.local',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'conflict', reason: 'already_invited' })

    await expect(
      revokeOCCProfileOrgInvite(userDataPath, { orgId, email: 'fresh@occ.local' })
    ).resolves.toEqual({ status: 'ok' })
    await expect(
      revokeOCCProfileOrgInvite(userDataPath, { orgId, email: 'fresh@occ.local' })
    ).resolves.toEqual({ status: 'not-found' })
  })

  it('blocks changing the dev owner (self) role', async () => {
    const orgId = 'dev-self-org'
    const list = await listOCCProfileOrgMembers(userDataPath, orgId)
    if (list.status !== 'ok') {
      throw new Error('expected ok')
    }
    const self = list.roster.members.find((member) => member.role === 'owner')
    await expect(
      changeOCCProfileOrgMemberRole(userDataPath, {
        orgId,
        userId: self?.userId ?? 'dev-user',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'invalid', reason: 'cannot_change_own_role' })
  })
})
