import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import {
  OCC_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  OCC_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL,
  type OCCCloudSignInProgress,
  type OCCProfileListResult,
  type SwitchOCCProfileResult,
  type TransferOCCProfileProjectResult
} from '../../shared/occ-profiles'
import { prepareAndInvokeAppRestart } from '../renderer-restart-wiring'
import { awaitBeforeUnloadCheckpoint } from '../preload-runtime-support'

export const occProfilesApi = {
  list: () => ipcRenderer.invoke('occProfiles:list'),
  authStatus: () => ipcRenderer.invoke('occProfiles:authStatus'),
  onAuthStatusChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(OCC_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(OCC_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
  },
  onSignInProgressChanged: (
    callback: (progress: OCCCloudSignInProgress | null) => void
  ): (() => void) => {
    const listener = (_event: unknown, progress: OCCCloudSignInProgress | null): void =>
      callback(progress)
    ipcRenderer.on(OCC_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(OCC_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, listener)
  },
  createLocal: (args) => ipcRenderer.invoke('occProfiles:createLocal', args),
  createCloudLinked: (args) => ipcRenderer.invoke('occProfiles:createCloudLinked', args),
  switchProfile: (args) =>
    prepareAndInvokeAppRestart(
      window,
      (): Promise<SwitchOCCProfileResult> => ipcRenderer.invoke('occProfiles:switch', args),
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'relaunching'
    ),
  transferProject: async (args) => {
    const invoke = (): Promise<TransferOCCProfileProjectResult> =>
      ipcRenderer.invoke('occProfiles:transferProject', args)
    if (args.mode !== 'move') {
      return invoke()
    }
    const current: OCCProfileListResult = await ipcRenderer.invoke('occProfiles:list')
    if (args.sourceProfileId !== current.activeProfileId) {
      return invoke()
    }
    return prepareAndInvokeAppRestart(
      window,
      invoke,
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'transferred' && result.willRelaunch === true
    )
  },
  findProjectProfiles: (args) => ipcRenderer.invoke('occProfiles:findProjectProfiles', args),
  connectCurrent: () => ipcRenderer.invoke('occProfiles:connectCurrent'),
  signInProgress: () => ipcRenderer.invoke('occProfiles:signInProgress'),
  cancelSignIn: () => ipcRenderer.invoke('occProfiles:cancelSignIn'),
  refreshAuth: () => ipcRenderer.invoke('occProfiles:refreshAuth'),
  signOutCurrent: () => ipcRenderer.invoke('occProfiles:signOutCurrent'),
  selectOrg: (args) => ipcRenderer.invoke('occProfiles:selectOrg', args),
  orgMembersList: (args) => ipcRenderer.invoke('occProfiles:orgMembersList', args),
  orgMemberInvite: (args) => ipcRenderer.invoke('occProfiles:orgMemberInvite', args),
  orgInviteRevoke: (args) => ipcRenderer.invoke('occProfiles:orgInviteRevoke', args),
  orgMemberChangeRole: (args) => ipcRenderer.invoke('occProfiles:orgMemberChangeRole', args),
  orgMemberRemove: (args) => ipcRenderer.invoke('occProfiles:orgMemberRemove', args)
} satisfies PreloadApi['occProfiles']
