import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  listOCCProfileOrgMembersMock,
  inviteOCCProfileOrgMemberMock,
  revokeOCCProfileOrgInviteMock,
  changeOCCProfileOrgMemberRoleMock,
  removeOCCProfileOrgMemberMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  listOCCProfileOrgMembersMock: vi.fn(),
  inviteOCCProfileOrgMemberMock: vi.fn(),
  revokeOCCProfileOrgInviteMock: vi.fn(),
  changeOCCProfileOrgMemberRoleMock: vi.fn(),
  removeOCCProfileOrgMemberMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../occ-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => '/tmp/occ-user-data'
}))

vi.mock('../occ-profiles/profile-cloud-org-members-service', () => ({
  listOCCProfileOrgMembers: listOCCProfileOrgMembersMock,
  inviteOCCProfileOrgMember: inviteOCCProfileOrgMemberMock,
  revokeOCCProfileOrgInvite: revokeOCCProfileOrgInviteMock,
  changeOCCProfileOrgMemberRole: changeOCCProfileOrgMemberRoleMock,
  removeOCCProfileOrgMember: removeOCCProfileOrgMemberMock
}))

import { registerOCCProfileOrgMemberHandlers } from './occ-profile-org-members-handlers'

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`No handler for ${channel}`)
  }
  return handler({}, args)
}

describe('registerOCCProfileOrgMemberHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    listOCCProfileOrgMembersMock.mockReset().mockResolvedValue({ status: 'ok', roster: {} })
    inviteOCCProfileOrgMemberMock.mockReset().mockResolvedValue({ status: 'ok' })
    revokeOCCProfileOrgInviteMock.mockReset().mockResolvedValue({ status: 'ok' })
    changeOCCProfileOrgMemberRoleMock.mockReset().mockResolvedValue({ status: 'ok' })
    removeOCCProfileOrgMemberMock.mockReset().mockResolvedValue({ status: 'ok' })
    registerOCCProfileOrgMemberHandlers()
  })

  it('registers all five org-member channels', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        'occProfiles:orgInviteRevoke',
        'occProfiles:orgMemberChangeRole',
        'occProfiles:orgMemberInvite',
        'occProfiles:orgMemberRemove',
        'occProfiles:orgMembersList'
      ].sort()
    )
  })

  it('forwards a valid invite to the service with a trimmed email', async () => {
    await invoke('occProfiles:orgMemberInvite', {
      orgId: 'org-1',
      email: '  new@example.com  ',
      role: 'admin'
    })
    expect(inviteOCCProfileOrgMemberMock).toHaveBeenCalledWith('/tmp/occ-user-data', {
      orgId: 'org-1',
      email: 'new@example.com',
      role: 'admin'
    })
  })

  it('rejects an invite with a missing org id', async () => {
    await expect(
      invoke('occProfiles:orgMemberInvite', { email: 'a@b.com', role: 'member' })
    ).rejects.toThrow('invalid_occ_profile_org_selection')
    expect(inviteOCCProfileOrgMemberMock).not.toHaveBeenCalled()
  })

  it('rejects an invite with an unknown role', async () => {
    await expect(
      invoke('occProfiles:orgMemberInvite', { orgId: 'org-1', email: 'a@b.com', role: 'root' })
    ).rejects.toThrow('invalid_occ_org_role')
  })

  it('rejects a role change with a blank user id', async () => {
    await expect(
      invoke('occProfiles:orgMemberChangeRole', { orgId: 'org-1', userId: '  ', role: 'admin' })
    ).rejects.toThrow('invalid_occ_org_member_user')
  })

  it('forwards remove and revoke with validated args', async () => {
    await invoke('occProfiles:orgMemberRemove', { orgId: 'org-1', userId: 'user-2' })
    expect(removeOCCProfileOrgMemberMock).toHaveBeenCalledWith('/tmp/occ-user-data', {
      orgId: 'org-1',
      userId: 'user-2'
    })
    await invoke('occProfiles:orgInviteRevoke', { orgId: 'org-1', email: 'gone@b.com' })
    expect(revokeOCCProfileOrgInviteMock).toHaveBeenCalledWith('/tmp/occ-user-data', {
      orgId: 'org-1',
      email: 'gone@b.com'
    })
  })
})
