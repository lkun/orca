import type { RefreshCurrentOCCProfileAuthResult } from '../../shared/occ-profiles'
import { getOCCCloudAuthConfig, isOCCCloudDevAuthEnabled } from './profile-cloud-auth-config'
import { getOCCProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { refreshOCCCloudCapabilities } from './profile-cloud-client'
import { ensureActiveOCCProfile } from './profile-index-store'
import { refreshDevOCCCloudProfile } from './profile-cloud-dev-service'
import {
  commitCloudSessionCapabilities,
  takeCloudSessionTicket,
  type CloudSessionTicket
} from './profile-cloud-session-owner'
import { runWithFreshOCCCloudSession } from './profile-cloud-session-refresh'

export async function refreshCurrentOCCProfileAuth(
  userDataPath: string
): Promise<RefreshCurrentOCCProfileAuthResult> {
  const active = ensureActiveOCCProfile(userDataPath)
  const auth = () => getOCCProfileAuthStatusFromProfile(active, userDataPath)
  if (!active.profile.cloud) {
    return { status: 'local', auth: auth() }
  }
  if (isOCCCloudDevAuthEnabled()) {
    const result = refreshDevOCCCloudProfile(active, userDataPath)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: auth(),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }
  const configState = getOCCCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: auth() }
  }
  try {
    const cloud = active.profile.cloud
    let ticket: CloudSessionTicket | undefined
    const operation = await runWithFreshOCCCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => {
        // Take the ticket after refresh because refreshing may relink the session.
        ticket = takeCloudSessionTicket(active.profile.id, userDataPath)
        return refreshOCCCloudCapabilities(configState.config, session)
      }
    )
    if (operation.status !== 'ok' || !ticket) {
      return { status: 'reconnect-required', auth: auth() }
    }
    const refresh = operation.value
    if (
      refresh.cloud &&
      (refresh.cloud.userId !== cloud.userId ||
        refresh.cloud.cloudProfileId !== cloud.cloudProfileId)
    ) {
      throw new Error('occ_cloud_identity_changed_during_capability_refresh')
    }
    const list = commitCloudSessionCapabilities(active.profile.id, userDataPath, ticket, refresh)
    if (!list) {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: getOCCProfileAuthStatusFromProfile(
        ensureActiveOCCProfile(userDataPath),
        userDataPath
      ),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: auth(),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
