import type { PreloadApi } from '../../../../preload/api-types'
import {
  DEFAULT_LOCAL_OCC_PROFILE_ID,
  createDefaultLocalOCCProfile
} from '../../../../shared/occ-profiles'
import { noopUnsubscribe } from './web-storage'

export function createWebOCCProfilesApi(): Partial<PreloadApi> {
  const webOCCProfileAuthStatus = () =>
    Promise.resolve({
      activeProfileId: DEFAULT_LOCAL_OCC_PROFILE_ID,
      configured: false,
      state: 'unconfigured' as const,
      persistence: 'none' as const,
      setupMessage: 'OCC Cloud sign-in is not available in the browser fallback.'
    })
  return {
    occProfiles: {
      list: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_OCC_PROFILE_ID,
          profiles: [createDefaultLocalOCCProfile(0)],
          multiProfileUi: false
        }),
      authStatus: webOCCProfileAuthStatus,
      onAuthStatusChanged: () => noopUnsubscribe,
      onSignInProgressChanged: () => noopUnsubscribe,
      createLocal: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_OCC_PROFILE_ID,
          profiles: [createDefaultLocalOCCProfile(0)],
          profile: createDefaultLocalOCCProfile(0)
        }),
      createCloudLinked: async () => ({
        status: 'unconfigured',
        auth: await webOCCProfileAuthStatus()
      }),
      switchProfile: () => Promise.resolve({ status: 'already-active' }),
      transferProject: (args) =>
        Promise.resolve({
          status: 'duplicate-target',
          sourceProfileId: args.sourceProfileId,
          targetProfileId: args.targetProfileId,
          sourceRepoId: args.repoId,
          duplicateRepoId: args.repoId
        }),
      findProjectProfiles: async () => ({ projects: [] }),
      connectCurrent: async () => ({
        status: 'unconfigured',
        auth: await webOCCProfileAuthStatus()
      }),
      signInProgress: async () => null,
      cancelSignIn: async () => {},
      refreshAuth: async () => ({
        status: 'unconfigured',
        auth: await webOCCProfileAuthStatus()
      }),
      signOutCurrent: async () => ({
        status: 'signed-out',
        auth: await webOCCProfileAuthStatus(),
        activeProfileId: DEFAULT_LOCAL_OCC_PROFILE_ID,
        profiles: [createDefaultLocalOCCProfile(0)]
      }),
      selectOrg: async () => ({
        status: 'unconfigured',
        auth: await webOCCProfileAuthStatus()
      }),
      orgMembersList: async () => ({ status: 'unconfigured' }),
      orgMemberInvite: async () => ({ status: 'unconfigured' }),
      orgInviteRevoke: async () => ({ status: 'unconfigured' }),
      orgMemberChangeRole: async () => ({ status: 'unconfigured' }),
      orgMemberRemove: async () => ({ status: 'unconfigured' })
    }
  }
}
