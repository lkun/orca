import { OCC_BROWSER_PARTITION } from './constants'
import type { ExecutionHostId } from './execution-host'

export const OCC_PROFILE_INDEX_SCHEMA_VERSION = 1
export const DEFAULT_LOCAL_OCC_PROFILE_ID = 'local-default'
export const DEFAULT_LOCAL_OCC_PROFILE_NAME = 'Personal'
/** Main -> renderer push when the stored auth status changed without the renderer asking. */
export const OCC_PROFILE_AUTH_STATUS_CHANGED_CHANNEL = 'occProfiles:authStatusChanged'
export const OCC_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL = 'occProfiles:signInProgressChanged'
const LEGACY_OCC_BROWSER_SESSION_PARTITION_PREFIX = 'persist:occ-browser-session-'

export type OCCProfileAvatar = {
  kind: 'initials'
  initials: string
  color: 'neutral'
}

export type OCCProfileKind = 'local' | 'cloud-linked'

export type OCCProfileCloudSummary = {
  cloudProfileId: string
  userId: string
  email: string
  displayName?: string
  activeOrgId?: string
  activeOrgName?: string
  linkedAt: number
}

export type OCCCloudOrgSummary = {
  orgId: string
  name: string
  role?: string
}

export type OCCCloudCapabilityFlags = Record<string, boolean>

export type OCCCloudCapabilities = {
  flags: OCCCloudCapabilityFlags
  refreshedAt: number
}

export type OCCCloudSessionPersistence = 'none' | 'encrypted' | 'memory-only' | 'dev-plaintext'

export type OCCProfileAuthState = 'local' | 'unconfigured' | 'connected' | 'reconnect-required'

export type OCCProfileAuthStatus = {
  activeProfileId: string
  configured: boolean
  state: OCCProfileAuthState
  persistence: OCCCloudSessionPersistence
  cloud?: OCCProfileCloudSummary
  organizations?: OCCCloudOrgSummary[]
  capabilities?: OCCCloudCapabilities
  credentialError?: string
  setupMessage?: string
}

export type OCCProfileSummary = {
  id: string
  name: string
  avatar: OCCProfileAvatar
  kind: OCCProfileKind
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  cloud?: OCCProfileCloudSummary
}

export type OCCProfileIndex = {
  schemaVersion: number
  activeProfileId: string
  profiles: OCCProfileSummary[]
}

export type OCCProfileListState = {
  activeProfileId: string
  profiles: OCCProfileSummary[]
}

export type OCCProfileListResult = OCCProfileListState & {
  // Gate the multi-profile switcher; default builds use one-profile account menus.
  multiProfileUi: boolean
}

export type CreateLocalOCCProfileArgs = {
  name?: string
}

export type CreateLocalOCCProfileResult = OCCProfileListState & {
  profile: OCCProfileSummary
}

export type CreateCloudLinkedOCCProfileArgs = {
  orgId?: string
  name?: string
}

export type SwitchOCCProfileArgs = {
  profileId: string
}

export type SwitchOCCProfileResult = {
  status: 'already-active' | 'relaunching'
}

export type TransferOCCProfileProjectMode = 'move' | 'copy'

export type TransferOCCProfileProjectArgs = {
  sourceProfileId: string
  targetProfileId: string
  repoId: string
  mode: TransferOCCProfileProjectMode
}

export type FindOCCProfileProjectsByPathArgs = {
  path: string
  connectionId?: string | null
  executionHostId?: ExecutionHostId | null
  excludeProfileId?: string | null
}

export type OCCProfileProjectPresence = {
  profileId: string
  profileName: string
  profileKind: OCCProfileKind
  repoId: string
  repoName: string
}

export type FindOCCProfileProjectsByPathResult = {
  projects: OCCProfileProjectPresence[]
}

export type TransferOCCProfileProjectResult =
  | {
      status: 'transferred'
      mode: TransferOCCProfileProjectMode
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      targetRepoId: string
      targetProjectId: string | null
      willRelaunch?: boolean
    }
  | {
      status: 'duplicate-target'
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      duplicateRepoId: string
    }

/** A sign-in in flight; `link` is set only while the browser has not answered yet. */
export type OCCCloudSignInProgress = { link: string | null }

export type ConnectCurrentOCCProfileResult =
  | {
      status: 'connected'
      auth: OCCProfileAuthStatus
      activeProfileId: string
      profiles: OCCProfileSummary[]
    }
  | {
      status: 'unconfigured'
      auth: OCCProfileAuthStatus
    }
  | {
      status: 'cancelled'
      auth: OCCProfileAuthStatus
    }
  | {
      status: 'timed-out'
      auth: OCCProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: OCCProfileAuthStatus
      error: string
    }

export type CreateCloudLinkedOCCProfileResult =
  | {
      status: 'created'
      auth: OCCProfileAuthStatus
      activeProfileId: string
      profiles: OCCProfileSummary[]
      profile: OCCProfileSummary
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: OCCProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: OCCProfileAuthStatus
      error: string
    }

export type SignOutCurrentOCCProfileResult = {
  status: 'signed-out'
  auth: OCCProfileAuthStatus
  activeProfileId: string
  profiles: OCCProfileSummary[]
}

export type SelectOCCProfileOrgArgs = {
  orgId: string
}

export type SelectOCCProfileOrgResult =
  | {
      status: 'selected'
      auth: OCCProfileAuthStatus
      activeProfileId: string
      profiles: OCCProfileSummary[]
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: OCCProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: OCCProfileAuthStatus
      error: string
    }

export type RefreshCurrentOCCProfileAuthResult =
  | {
      status: 'refreshed'
      auth: OCCProfileAuthStatus
      activeProfileId: string
      profiles: OCCProfileSummary[]
    }
  | {
      status: 'local' | 'unconfigured' | 'reconnect-required'
      auth: OCCProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: OCCProfileAuthStatus
      error: string
    }

// Mirror the server’s fixed role enum so UI options cannot drift from accepted API values.
export type OCCOrgRole = 'owner' | 'admin' | 'member'

export type OCCOrgMember = {
  // Provisioned teammates without sign-in have no userId; disable mutations requiring that key.
  userId: string | null
  email: string
  displayName?: string
  role: OCCOrgRole
}

export type OCCOrgPendingInvite = {
  email: string
  role: OCCOrgRole
  createdAt: number
}

export type OCCOrgMembersRoster = {
  members: OCCOrgMember[]
  pendingInvites: OCCOrgPendingInvite[]
  viewerRole: OCCOrgRole
  canManageMembers: boolean
}

export type OCCProfileOrgMembersListArgs = {
  orgId: string
}

export type OCCProfileOrgMemberInviteArgs = {
  orgId: string
  email: string
  role: OCCOrgRole
}

export type OCCProfileOrgInviteRevokeArgs = {
  orgId: string
  email: string
}

export type OCCProfileOrgMemberChangeRoleArgs = {
  orgId: string
  userId: string
  role: OCCOrgRole
}

export type OCCProfileOrgMemberRemoveArgs = {
  orgId: string
  userId: string
}

export type OCCProfileOrgMembersListResult =
  | { status: 'ok'; roster: OCCOrgMembersRoster }
  | { status: 'unconfigured' | 'reconnect-required' }
  | { status: 'failed'; error: string }

export type OCCOrgInviteConflictReason = 'already_member' | 'already_invited'
export type OCCOrgMutationInvalidReason = 'cannot_change_own_role' | 'cannot_remove_self'

export type OCCProfileOrgMemberMutationResult =
  | { status: 'ok' }
  | { status: 'unconfigured' | 'reconnect-required' | 'forbidden' | 'not-found' }
  | { status: 'conflict'; reason: OCCOrgInviteConflictReason }
  | { status: 'invalid'; reason: OCCOrgMutationInvalidReason }
  | { status: 'failed'; error: string }

export function createDefaultLocalOCCProfile(now: number): OCCProfileSummary {
  return {
    id: DEFAULT_LOCAL_OCC_PROFILE_ID,
    name: DEFAULT_LOCAL_OCC_PROFILE_NAME,
    avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
    kind: 'local',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  }
}

function profilePartitionHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function getOCCProfileBrowserPartitionSegment(profileId: string): string {
  const safe = profileId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'profile'
  return `${safe}-${profilePartitionHash(profileId)}`
}

export function getOCCProfileBrowserDefaultPartition(profileId: string): string {
  if (profileId === DEFAULT_LOCAL_OCC_PROFILE_ID) {
    return OCC_BROWSER_PARTITION
  }
  return `persist:occ-profile-${getOCCProfileBrowserPartitionSegment(profileId)}-browser-default`
}

export function getOCCProfileBrowserSessionPartition(
  profileId: string,
  browserSessionProfileId: string
): string {
  if (profileId === DEFAULT_LOCAL_OCC_PROFILE_ID) {
    return `${LEGACY_OCC_BROWSER_SESSION_PARTITION_PREFIX}${browserSessionProfileId}`
  }
  return `persist:occ-profile-${getOCCProfileBrowserPartitionSegment(
    profileId
  )}-browser-session-${browserSessionProfileId}`
}
