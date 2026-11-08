import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  OCCCloudSignInProgress,
  OCCProfileAuthStatus,
  OCCProfileSummary,
  SwitchOCCProfileResult,
  TransferOCCProfileProjectArgs,
  TransferOCCProfileProjectResult
} from '../../../../../shared/occ-profiles'
import type { AppState } from '../../types'
import {
  createOCCProfilesAuthActions,
  type OCCProfilesAuthActions
} from './occ-profiles-auth-actions'

export type OCCProfilesSlice = OCCProfilesAuthActions & {
  occProfiles: OCCProfileSummary[]
  activeOCCProfileId: string | null
  occProfileAuthStatus: OCCProfileAuthStatus | null
  occProfileSignInProgress: OCCCloudSignInProgress | null
  occProfilesMultiProfileUi: boolean
  occProfilesLoading: boolean
  occProfileSwitching: boolean
  fetchOCCProfiles: () => Promise<void>
  fetchOCCProfileAuthStatus: () => Promise<OCCProfileAuthStatus | null>
  createLocalOCCProfile: (name?: string) => Promise<OCCProfileSummary | null>
  switchOCCProfile: (profileId: string) => Promise<SwitchOCCProfileResult | null>
  transferOCCProfileProject: (
    args: TransferOCCProfileProjectArgs
  ) => Promise<TransferOCCProfileProjectResult | null>
}

export const createOCCProfilesSlice: StateCreator<AppState, [], [], OCCProfilesSlice> = (
  set,
  get,
  api
) => ({
  occProfiles: [],
  activeOCCProfileId: null,
  occProfileAuthStatus: null,
  occProfileSignInProgress: null,
  occProfilesMultiProfileUi: false,
  occProfilesLoading: false,
  occProfileSwitching: false,

  fetchOCCProfiles: async () => {
    set({ occProfilesLoading: true })
    try {
      const [state, authStatus] = await Promise.all([
        window.api.occProfiles.list(),
        window.api.occProfiles.authStatus()
      ])
      set({
        activeOCCProfileId: state.activeProfileId,
        occProfiles: state.profiles,
        occProfilesMultiProfileUi: state.multiProfileUi,
        occProfileAuthStatus: authStatus,
        occProfilesLoading: false
      })
    } catch (err) {
      console.error('Failed to fetch OCC profiles:', err)
      set({ occProfilesLoading: false })
    }
  },

  fetchOCCProfileAuthStatus: async () => {
    try {
      const authStatus = await window.api.occProfiles.authStatus()
      set({ occProfileAuthStatus: authStatus })
      return authStatus
    } catch (err) {
      console.error('Failed to fetch OCC profile auth status:', err)
      return null
    }
  },

  createLocalOCCProfile: async (name) => {
    try {
      const state = await window.api.occProfiles.createLocal({ name })
      set({
        activeOCCProfileId: state.activeProfileId,
        occProfiles: state.profiles
      })
      void get().fetchOCCProfileAuthStatus()
      return state.profile
    } catch (err) {
      console.error('Failed to create OCC profile:', err)
      toast.error(
        translate('auto.store.slices.occ.profiles.612f7f6861', 'Failed to create profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  ...createOCCProfilesAuthActions(set, get, api),

  switchOCCProfile: async (profileId) => {
    if (!profileId || profileId === get().activeOCCProfileId) {
      return { status: 'already-active' }
    }
    set({ occProfileSwitching: true })
    try {
      const result = await window.api.occProfiles.switchProfile({ profileId })
      if (result?.status !== 'relaunching') {
        // Only actual relaunch locks switcher; stale already-active answers must unlock it.
        set({ occProfileSwitching: false })
      }
      return result
    } catch (err) {
      console.error('Failed to switch OCC profile:', err)
      set({ occProfileSwitching: false })
      toast.error(
        translate('auto.store.slices.occ.profiles.7d4bc516ee', 'Failed to switch profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  transferOCCProfileProject: async (args) => {
    try {
      const result = await window.api.occProfiles.transferProject(args)
      if (result.status === 'duplicate-target') {
        toast.error(
          translate(
            'auto.store.slices.occ.profiles.f518e89aa5',
            'Project already exists in that profile'
          )
        )
      }
      if (result.status === 'transferred' && result.willRelaunch) {
        set({ occProfileSwitching: true })
      }
      return result
    } catch (err) {
      console.error('Failed to transfer OCC profile project:', err)
      toast.error(
        translate('auto.store.slices.occ.profiles.f03ae7f27b', 'Failed to transfer project'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  }
})
