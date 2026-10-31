import type {
  ConnectCurrentOCCProfileResult,
  CreateCloudLinkedOCCProfileArgs,
  CreateCloudLinkedOCCProfileResult,
  OCCProfileAuthStatus,
  SelectOCCProfileOrgResult,
  SignOutCurrentOCCProfileResult
} from '../../shared/occ-profiles'
import { ensureActiveOCCProfile } from './profile-index-store'
import { getOCCCloudAuthConfig, isOCCCloudDevAuthEnabled } from './profile-cloud-auth-config'
import {
  invalidateCloudSessionChanges,
  readCloudSession,
  signInCloudSession,
  signOutCloudSession
} from './profile-cloud-session-owner'
import {
  createOCCCloudProfile,
  exchangeOCCCloudAuthCode,
  revokeOCCCloudSession
} from './profile-cloud-client'
import { beginOCCCloudPkceFlow } from './profile-cloud-pkce'
import {
  createCloudLinkedOCCProfileRecord,
  linkOCCProfileToCloud,
  unlinkOCCProfileFromCloud
} from './profile-cloud-index'
import { runWithFreshOCCCloudSession } from './profile-cloud-session-refresh'
import {
  connectDevOCCCloudProfile,
  createDevCloudLinkedOCCProfile,
  selectDevOCCCloudOrg
} from './profile-cloud-dev-service'
import { getOCCProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { selectCloudOrg } from './profile-cloud-org-selection'
import {
  endOCCCloudSignInProgress,
  setOCCCloudSignInLink,
  startOCCCloudSignInProgress
} from './profile-cloud-sign-in-progress'
import { clearRelayRegionPreferenceCache } from '../runtime/mobile-cloud-relay/relay-region-preference'

export { refreshCurrentOCCProfileAuth } from './profile-cloud-capability-refresh'

let nextCloudConnectAttempt = 0
let linkedCloudConnectAttempt = 0

function invalidateOutstandingCloudConnectAttempts(): void {
  nextCloudConnectAttempt += 1
  linkedCloudConnectAttempt = nextCloudConnectAttempt
  endOCCCloudSignInProgress()
}

function activeAuth(
  active: ReturnType<typeof ensureActiveOCCProfile>,
  userDataPath: string
): OCCProfileAuthStatus {
  return getOCCProfileAuthStatusFromProfile(active, userDataPath)
}

export function getCurrentOCCProfileAuthStatus(userDataPath: string): OCCProfileAuthStatus {
  return getOCCProfileAuthStatusFromProfile(ensureActiveOCCProfile(userDataPath), userDataPath)
}

export async function connectCurrentOCCProfile(
  userDataPath: string
): Promise<ConnectCurrentOCCProfileResult> {
  const active = ensureActiveOCCProfile(userDataPath)
  if (isOCCCloudDevAuthEnabled()) {
    const list = connectDevOCCCloudProfile(active, userDataPath)
    return {
      status: 'connected',
      auth: getCurrentOCCProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  }

  const configState = getOCCCloudAuthConfig()
  if (!configState.configured) {
    return {
      status: 'unconfigured',
      auth: activeAuth(active, userDataPath)
    }
  }

  const attempt = ++nextCloudConnectAttempt
  const browserWait = new AbortController()
  startOCCCloudSignInProgress(attempt, () => browserWait.abort())
  try {
    const code = await beginOCCCloudPkceFlow(configState.config, active.profile.id, {
      signal: browserWait.signal,
      onAuthorizeUrl: (link) => setOCCCloudSignInLink(attempt, link)
    })
    // The callback listener has closed, so its browser link is dead.
    setOCCCloudSignInLink(attempt, null)
    if (attempt < linkedCloudConnectAttempt) {
      return {
        status: 'cancelled',
        auth: getCurrentOCCProfileAuthStatus(userDataPath)
      }
    }
    const exchange = await exchangeOCCCloudAuthCode(configState.config, {
      ...code,
      localProfileId: active.profile.id
    })
    if (attempt < linkedCloudConnectAttempt) {
      return {
        status: 'cancelled',
        auth: getCurrentOCCProfileAuthStatus(userDataPath)
      }
    }
    signInCloudSession(active.profile.id, userDataPath, exchange)
    const list = linkOCCProfileToCloud(active.profile.id, exchange.cloud, userDataPath)
    linkedCloudConnectAttempt = attempt
    return {
      status: 'connected',
      auth: getCurrentOCCProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'occ_cloud_auth_timeout' && attempt === nextCloudConnectAttempt) {
      return {
        status: 'timed-out',
        auth: getCurrentOCCProfileAuthStatus(userDataPath)
      }
    }
    if (
      message === 'occ_cloud_auth_timeout' ||
      message === 'occ_cloud_auth_denied' ||
      message === 'occ_cloud_auth_cancelled'
    ) {
      return {
        status: 'cancelled',
        auth: getCurrentOCCProfileAuthStatus(userDataPath)
      }
    }
    return {
      status: 'failed',
      auth: getCurrentOCCProfileAuthStatus(userDataPath),
      error: message
    }
  } finally {
    endOCCCloudSignInProgress(attempt)
  }
}

export async function signOutCurrentOCCProfile(
  userDataPath: string
): Promise<SignOutCurrentOCCProfileResult> {
  // Pending browser sign-ins must not relink after explicit sign-out.
  invalidateOutstandingCloudConnectAttempts()
  const signOutEpoch = linkedCloudConnectAttempt
  const active = ensureActiveOCCProfile(userDataPath)
  const configState = getOCCCloudAuthConfig()
  const session = readCloudSession(active.profile.id, userDataPath)
  // Fence before network I/O so in-flight refreshes cannot save after sign-out.
  invalidateCloudSessionChanges(active.profile.id, userDataPath)
  if (!isOCCCloudDevAuthEnabled() && configState.configured && session.status === 'found') {
    await revokeOCCCloudSession(configState.config, session.session).catch(() => undefined)
  }
  if (linkedCloudConnectAttempt > signOutEpoch) {
    const current = ensureActiveOCCProfile(userDataPath)
    return {
      status: 'signed-out',
      auth: getCurrentOCCProfileAuthStatus(userDataPath),
      activeProfileId: current.index.activeProfileId,
      profiles: current.index.profiles
    }
  }
  signOutCloudSession(active.profile.id, userDataPath)
  const list = unlinkOCCProfileFromCloud(active.profile.id, userDataPath)
  try {
    clearRelayRegionPreferenceCache(userDataPath)
  } catch {
    // A leftover latency cache must not fail the sign-out itself.
  }
  return {
    status: 'signed-out',
    auth: getCurrentOCCProfileAuthStatus(userDataPath),
    activeProfileId: list.activeProfileId,
    profiles: list.profiles
  }
}

export async function createCloudLinkedOCCProfile(
  userDataPath: string,
  args: CreateCloudLinkedOCCProfileArgs
): Promise<CreateCloudLinkedOCCProfileResult> {
  const active = ensureActiveOCCProfile(userDataPath)
  if (isOCCCloudDevAuthEnabled()) {
    const result = createDevCloudLinkedOCCProfile(active, userDataPath, args)
    if (result.status !== 'created') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'created',
      auth: getCurrentOCCProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles,
      profile: result.list.profile
    }
  }

  const configState = getOCCCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const operation = await runWithFreshOCCCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => createOCCCloudProfile(configState.config, session, args)
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    const created = operation.value
    const list = createCloudLinkedOCCProfileRecord(
      created.cloud,
      { name: args.name },
      userDataPath
    )
    signInCloudSession(list.profile.id, userDataPath, created)
    return {
      status: 'created',
      auth: getCurrentOCCProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles,
      profile: list.profile
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentOCCProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function selectCurrentOCCProfileOrg(
  userDataPath: string,
  orgId: string
): Promise<SelectOCCProfileOrgResult> {
  const active = ensureActiveOCCProfile(userDataPath)
  if (isOCCCloudDevAuthEnabled()) {
    const result = selectDevOCCCloudOrg(active, userDataPath, orgId)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentOCCProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }

  const configState = getOCCCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const list = await selectCloudOrg({
      config: configState.config,
      active,
      userDataPath,
      orgId
    })
    if (!list) {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentOCCProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentOCCProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
