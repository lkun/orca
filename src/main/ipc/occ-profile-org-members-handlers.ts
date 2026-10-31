import { ipcMain } from 'electron'
import type {
  OCCOrgRole,
  OCCProfileOrgInviteRevokeArgs,
  OCCProfileOrgMemberChangeRoleArgs,
  OCCProfileOrgMemberInviteArgs,
  OCCProfileOrgMemberMutationResult,
  OCCProfileOrgMemberRemoveArgs,
  OCCProfileOrgMembersListArgs,
  OCCProfileOrgMembersListResult
} from '../../shared/occ-profiles'
import { getProfileUserDataPath } from '../occ-profiles/profile-storage-paths'
import {
  changeOCCProfileOrgMemberRole,
  inviteOCCProfileOrgMember,
  listOCCProfileOrgMembers,
  removeOCCProfileOrgMember,
  revokeOCCProfileOrgInvite
} from '../occ-profiles/profile-cloud-org-members-service'

function orgMembersScopedArgs(args: unknown): { orgId: string; record: Record<string, unknown> } {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_occ_profile_org_selection')
  }
  const record = args as Record<string, unknown>
  const orgId = typeof record.orgId === 'string' ? record.orgId.trim() : ''
  if (!orgId) {
    throw new Error('invalid_occ_profile_org_selection')
  }
  return { orgId, record }
}

function orgRoleFromUnknown(value: unknown): OCCOrgRole {
  if (value === 'owner' || value === 'admin' || value === 'member') {
    return value
  }
  throw new Error('invalid_occ_org_role')
}

function orgEmailFromUnknown(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : ''
  if (!email) {
    throw new Error('invalid_occ_org_member_email')
  }
  return email
}

function orgUserIdFromUnknown(value: unknown): string {
  const userId = typeof value === 'string' ? value.trim() : ''
  if (!userId) {
    throw new Error('invalid_occ_org_member_user')
  }
  return userId
}

function orgMemberInviteArgsFromUnknown(args: unknown): OCCProfileOrgMemberInviteArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email), role: orgRoleFromUnknown(record.role) }
}

function orgInviteRevokeArgsFromUnknown(args: unknown): OCCProfileOrgInviteRevokeArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email) }
}

function orgMemberChangeRoleArgsFromUnknown(args: unknown): OCCProfileOrgMemberChangeRoleArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return {
    orgId,
    userId: orgUserIdFromUnknown(record.userId),
    role: orgRoleFromUnknown(record.role)
  }
}

function orgMemberRemoveArgsFromUnknown(args: unknown): OCCProfileOrgMemberRemoveArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, userId: orgUserIdFromUnknown(record.userId) }
}

export function registerOCCProfileOrgMemberHandlers(): void {
  ipcMain.handle(
    'occProfiles:orgMembersList',
    async (
      _event,
      rawArgs: OCCProfileOrgMembersListArgs
    ): Promise<OCCProfileOrgMembersListResult> =>
      listOCCProfileOrgMembers(getProfileUserDataPath(), orgMembersScopedArgs(rawArgs).orgId)
  )

  ipcMain.handle(
    'occProfiles:orgMemberInvite',
    async (
      _event,
      rawArgs: OCCProfileOrgMemberInviteArgs
    ): Promise<OCCProfileOrgMemberMutationResult> =>
      inviteOCCProfileOrgMember(getProfileUserDataPath(), orgMemberInviteArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'occProfiles:orgInviteRevoke',
    async (
      _event,
      rawArgs: OCCProfileOrgInviteRevokeArgs
    ): Promise<OCCProfileOrgMemberMutationResult> =>
      revokeOCCProfileOrgInvite(getProfileUserDataPath(), orgInviteRevokeArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'occProfiles:orgMemberChangeRole',
    async (
      _event,
      rawArgs: OCCProfileOrgMemberChangeRoleArgs
    ): Promise<OCCProfileOrgMemberMutationResult> =>
      changeOCCProfileOrgMemberRole(
        getProfileUserDataPath(),
        orgMemberChangeRoleArgsFromUnknown(rawArgs)
      )
  )

  ipcMain.handle(
    'occProfiles:orgMemberRemove',
    async (
      _event,
      rawArgs: OCCProfileOrgMemberRemoveArgs
    ): Promise<OCCProfileOrgMemberMutationResult> =>
      removeOCCProfileOrgMember(getProfileUserDataPath(), orgMemberRemoveArgsFromUnknown(rawArgs))
  )
}
