import type {
  CreateCloudLinkedOCCProfileArgs,
  OCCProfileListState
} from '../../shared/occ-profiles'
import type { ActiveOCCProfileState } from './profile-index-store'
import { createCloudLinkedOCCProfileRecord, linkOCCProfileToCloud } from './profile-cloud-index'
import { readCloudSession, signInCloudSession } from './profile-cloud-session-owner'
import { createDevOCCCloudSession } from './profile-cloud-dev-auth'

type DevProfileListResult = OCCProfileListState

type DevCreateProfileResult =
  | {
      status: 'created'
      list: ReturnType<typeof createCloudLinkedOCCProfileRecord>
    }
  | { status: 'reconnect-required' }

type DevMutationResult =
  | {
      status: 'updated'
      list: DevProfileListResult
    }
  | { status: 'reconnect-required' }

export function connectDevOCCCloudProfile(
  active: ActiveOCCProfileState,
  userDataPath: string
): DevProfileListResult {
  const session = createDevOCCCloudSession({ localProfileId: active.profile.id })
  signInCloudSession(active.profile.id, userDataPath, session)
  return linkOCCProfileToCloud(active.profile.id, session.cloud, userDataPath)
}

export function createDevCloudLinkedOCCProfile(
  active: ActiveOCCProfileState,
  userDataPath: string,
  args: CreateCloudLinkedOCCProfileArgs
): DevCreateProfileResult {
  if (readCloudSession(active.profile.id, userDataPath).status !== 'found') {
    return { status: 'reconnect-required' }
  }
  const session = createDevOCCCloudSession({ orgId: args.orgId })
  const list = createCloudLinkedOCCProfileRecord(session.cloud, { name: args.name }, userDataPath)
  signInCloudSession(list.profile.id, userDataPath, session)
  return { status: 'created', list }
}

export function refreshDevOCCCloudProfile(
  active: ActiveOCCProfileState,
  userDataPath: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevOCCCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId: active.profile.cloud.activeOrgId
  })
  signInCloudSession(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkOCCProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}

export function selectDevOCCCloudOrg(
  active: ActiveOCCProfileState,
  userDataPath: string,
  orgId: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevOCCCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId
  })
  signInCloudSession(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkOCCProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}
