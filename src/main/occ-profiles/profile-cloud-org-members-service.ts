import type {
  OCCProfileOrgInviteRevokeArgs,
  OCCProfileOrgMemberChangeRoleArgs,
  OCCProfileOrgMemberInviteArgs,
  OCCProfileOrgMemberMutationResult,
  OCCProfileOrgMemberRemoveArgs,
  OCCProfileOrgMembersListResult
} from '../../shared/occ-profiles'
import type { ActiveOCCProfileState } from './profile-index-store'
import { ensureActiveOCCProfile } from './profile-index-store'
import type { OCCCloudAuthConfig } from './profile-cloud-auth-config'
import { getOCCCloudAuthConfig, isOCCCloudDevAuthEnabled } from './profile-cloud-auth-config'
import type { OCCCloudSession } from './profile-cloud-session-store'
import { OCCCloudRequestError } from './profile-cloud-client'
import { runWithFreshOCCCloudSession } from './profile-cloud-session-refresh'
import {
  changeOCCCloudOrgMemberRole,
  inviteOCCCloudOrgMember,
  listOCCCloudOrgMembers,
  removeOCCCloudOrgMember,
  revokeOCCCloudOrgInvite
} from './profile-cloud-org-members-client'
import {
  changeDevOCCCloudOrgMemberRole,
  inviteDevOCCCloudOrgMember,
  listDevOCCCloudOrgMembers,
  removeDevOCCCloudOrgMember,
  revokeDevOCCCloudOrgInvite
} from './profile-cloud-dev-org-members'

type OrgCallResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'reconnect-required' }
  | { status: 'request-error'; error: OCCCloudRequestError }
  | { status: 'failed'; error: string }

// Only 401 should trigger session refresh; return business/permission failures as values.
async function runOrgMemberCall<T>(
  config: OCCCloudAuthConfig,
  active: ActiveOCCProfileState,
  userDataPath: string,
  call: (session: OCCCloudSession) => Promise<T>
): Promise<OrgCallResult<T>> {
  try {
    const operation = await runWithFreshOCCCloudSession(
      config,
      active,
      userDataPath,
      async (session) => {
        try {
          return { ok: true as const, value: await call(session) }
        } catch (error) {
          if (error instanceof OCCCloudRequestError && error.statusCode !== 401) {
            return { ok: false as const, error }
          }
          throw error
        }
      }
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required' }
    }
    const outcome = operation.value
    return outcome.ok
      ? { status: 'ok', value: outcome.value }
      : { status: 'request-error', error: outcome.error }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

function mapMutationRequestError(error: OCCCloudRequestError): OCCProfileOrgMemberMutationResult {
  switch (error.statusCode) {
    case 403:
      return { status: 'forbidden' }
    case 404:
      return { status: 'not-found' }
    case 409:
      return {
        status: 'conflict',
        reason: error.errorCode === 'already_member' ? 'already_member' : 'already_invited'
      }
    case 400:
      return {
        status: 'invalid',
        reason:
          error.errorCode === 'cannot_remove_self' ? 'cannot_remove_self' : 'cannot_change_own_role'
      }
    default:
      return { status: 'failed', error: error.message }
  }
}

function mapMutationResult(result: OrgCallResult<void>): OCCProfileOrgMemberMutationResult {
  switch (result.status) {
    case 'ok':
      return { status: 'ok' }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return mapMutationRequestError(result.error)
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function listOCCProfileOrgMembers(
  userDataPath: string,
  orgId: string
): Promise<OCCProfileOrgMembersListResult> {
  const active = ensureActiveOCCProfile(userDataPath)
  if (isOCCCloudDevAuthEnabled()) {
    return { status: 'ok', roster: listDevOCCCloudOrgMembers(orgId) }
  }
  const configState = getOCCCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  const result = await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
    listOCCCloudOrgMembers(configState.config, session, orgId)
  )
  switch (result.status) {
    case 'ok':
      return { status: 'ok', roster: result.value }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return { status: 'failed', error: result.error.message }
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function inviteOCCProfileOrgMember(
  userDataPath: string,
  args: OCCProfileOrgMemberInviteArgs
): Promise<OCCProfileOrgMemberMutationResult> {
  const active = ensureActiveOCCProfile(userDataPath)
  if (isOCCCloudDevAuthEnabled()) {
    return inviteDevOCCCloudOrgMember(args)
  }
  const configState = getOCCCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      inviteOCCCloudOrgMember(configState.config, session, args)
    )
  )
}

export async function revokeOCCProfileOrgInvite(
  userDataPath: string,
  args: OCCProfileOrgInviteRevokeArgs
): Promise<OCCProfileOrgMemberMutationResult> {
  const active = ensureActiveOCCProfile(userDataPath)
  if (isOCCCloudDevAuthEnabled()) {
    return revokeDevOCCCloudOrgInvite(args)
  }
  const configState = getOCCCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      revokeOCCCloudOrgInvite(configState.config, session, args)
    )
  )
}

export async function changeOCCProfileOrgMemberRole(
  userDataPath: string,
  args: OCCProfileOrgMemberChangeRoleArgs
): Promise<OCCProfileOrgMemberMutationResult> {
  const active = ensureActiveOCCProfile(userDataPath)
  if (isOCCCloudDevAuthEnabled()) {
    return changeDevOCCCloudOrgMemberRole(args)
  }
  const configState = getOCCCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      changeOCCCloudOrgMemberRole(configState.config, session, args)
    )
  )
}

export async function removeOCCProfileOrgMember(
  userDataPath: string,
  args: OCCProfileOrgMemberRemoveArgs
): Promise<OCCProfileOrgMemberMutationResult> {
  const active = ensureActiveOCCProfile(userDataPath)
  if (isOCCCloudDevAuthEnabled()) {
    return removeDevOCCCloudOrgMember(args)
  }
  const configState = getOCCCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      removeOCCCloudOrgMember(configState.config, session, args)
    )
  )
}
