import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ConnectCurrentOCCProfileResult,
  CreateCloudLinkedOCCProfileResult,
  RefreshCurrentOCCProfileAuthResult,
  SelectOCCProfileOrgResult,
  SignOutCurrentOCCProfileResult
} from '../../../../../shared/occ-profiles'
import type { AppState } from '../../types'

export type OCCProfilesAuthActions = {
  createCloudLinkedOCCProfile: (args: {
    orgId?: string
    name?: string
  }) => Promise<CreateCloudLinkedOCCProfileResult | null>
  connectCurrentOCCProfile: () => Promise<ConnectCurrentOCCProfileResult | null>
  refreshCurrentOCCProfileAuth: () => Promise<RefreshCurrentOCCProfileAuthResult | null>
  signOutCurrentOCCProfile: () => Promise<SignOutCurrentOCCProfileResult | null>
  selectOCCProfileOrg: (orgId: string) => Promise<SelectOCCProfileOrgResult | null>
}

export const createOCCProfilesAuthActions: StateCreator<
  AppState,
  [],
  [],
  OCCProfilesAuthActions
> = (set, get) => {
  let nextConnectAttempt = 0
  let appliedConnectAttempt = 0

  return {
    createCloudLinkedOCCProfile: async (args) => {
      try {
        const result = await window.api.occProfiles.createCloudLinked(args)
        set({
          occProfileAuthStatus: result.auth,
          ...(result.status === 'created'
            ? {
                activeOCCProfileId: result.activeProfileId,
                occProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'created') {
          toast.success(
            translate('auto.store.slices.occ.profiles.319d7cf39b', 'Cloud profile created')
          )
        } else if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.occ.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.occ.profiles.f0c9e11a6d',
              'Failed to create cloud profile'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to create OCC cloud profile:', err)
        toast.error(
          translate('auto.store.slices.occ.profiles.f0c9e11a6d', 'Failed to create cloud profile'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    connectCurrentOCCProfile: async () => {
      const attempt = ++nextConnectAttempt
      try {
        // Pending PKCE must not block retry; newer linked waits supersede older callbacks.
        const result = await window.api.occProfiles.connectCurrent()
        if (attempt < appliedConnectAttempt) {
          return result
        }
        const alreadyConnected = get().occProfileAuthStatus?.state === 'connected'
        set({
          occProfileAuthStatus: result.auth,
          ...(result.status === 'connected'
            ? {
                activeOCCProfileId: result.activeProfileId,
                occProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'connected') {
          appliedConnectAttempt = attempt
          if (!alreadyConnected) {
            toast.success(
              translate('auto.store.slices.occ.profiles.9fcb07a796', 'Profile connected')
            )
          }
        } else if (result.status === 'unconfigured') {
          toast.error(
            translate(
              'auto.store.slices.occ.profiles.8b8fa73174',
              'OCC Cloud sign-in is not configured'
            ),
            {
              description: result.auth.setupMessage
            }
          )
        } else if (result.status === 'timed-out' && !alreadyConnected) {
          toast.error(
            translate('auto.store.slices.occ.profiles.signInTimedOut', 'Sign-in timed out')
          )
        } else if (
          result.status === 'failed' &&
          !alreadyConnected &&
          result.auth.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.occ.profiles.33290e88ed', 'Failed to connect profile'),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to connect OCC profile:', err)
        if (
          attempt >= appliedConnectAttempt &&
          get().occProfileAuthStatus?.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.occ.profiles.33290e88ed', 'Failed to connect profile'),
            {
              description: err instanceof Error ? err.message : String(err)
            }
          )
        }
        return null
      }
    },

    refreshCurrentOCCProfileAuth: async () => {
      try {
        const result = await window.api.occProfiles.refreshAuth()
        set({
          occProfileAuthStatus: result.auth,
          ...(result.status === 'refreshed'
            ? {
                activeOCCProfileId: result.activeProfileId,
                occProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.occ.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.occ.profiles.2f6c78a039',
              'Failed to refresh profile auth'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to refresh OCC profile auth:', err)
        toast.error(
          translate('auto.store.slices.occ.profiles.2f6c78a039', 'Failed to refresh profile auth'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    signOutCurrentOCCProfile: async () => {
      nextConnectAttempt += 1
      appliedConnectAttempt = nextConnectAttempt
      try {
        const result = await window.api.occProfiles.signOutCurrent()
        set({
          activeOCCProfileId: result.activeProfileId,
          occProfiles: result.profiles,
          occProfileAuthStatus: result.auth
        })
        if (result.auth.state !== 'connected') {
          toast.success(
            translate('auto.store.slices.occ.profiles.a37b5e6d37', 'Signed out of profile')
          )
        }
        return result
      } catch (err) {
        console.error('Failed to sign out of OCC profile:', err)
        toast.error(translate('auto.store.slices.occ.profiles.83600521e7', 'Failed to sign out'), {
          description: err instanceof Error ? err.message : String(err)
        })
        return null
      }
    },

    selectOCCProfileOrg: async (orgId) => {
      try {
        const result = await window.api.occProfiles.selectOrg({ orgId })
        set({
          occProfileAuthStatus: result.auth,
          ...(result.status === 'selected'
            ? {
                activeOCCProfileId: result.activeProfileId,
                occProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.occ.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.occ.profiles.76deec8f58',
              'Failed to switch organization'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to switch OCC profile org:', err)
        toast.error(
          translate('auto.store.slices.occ.profiles.76deec8f58', 'Failed to switch organization'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    }
  }
}
