import { ipcMain, type WebContents } from 'electron'
import type { Store } from '../persistence/loading-store/store'
import { relaunchApp, type AppRelaunchReason } from '../startup/quit/app-relaunch'
import { quitProcess } from '../startup/process-quit-request'
import type {
  CreateLocalOCCProfileArgs,
  CreateLocalOCCProfileResult,
  CreateCloudLinkedOCCProfileArgs,
  CreateCloudLinkedOCCProfileResult,
  FindOCCProfileProjectsByPathArgs,
  FindOCCProfileProjectsByPathResult,
  OCCProfileListResult,
  RefreshCurrentOCCProfileAuthResult,
  SwitchOCCProfileArgs,
  SwitchOCCProfileResult,
  TransferOCCProfileProjectArgs,
  TransferOCCProfileProjectResult,
  ConnectCurrentOCCProfileResult,
  OCCProfileAuthStatus,
  OCCCloudSignInProgress,
  SelectOCCProfileOrgArgs,
  SelectOCCProfileOrgResult,
  SignOutCurrentOCCProfileResult
} from '../../shared/occ-profiles'
import {
  createLocalOCCProfile,
  getOCCProfileListState,
  seedNewOCCProfileTelemetryConsent,
  setActiveOCCProfile
} from '../occ-profiles/profile-index-store'
import { getProfileUserDataPath } from '../occ-profiles/profile-storage-paths'
import { isMultiProfileUiEnabled } from '../occ-profiles/profile-ui-scope'
import { transferOCCProfileProject } from '../occ-profiles/profile-project-transfer'
import { transferActiveProfileProject } from '../occ-profiles/profile-active-transfer'
import { findOCCProfileProjectsByPath } from '../occ-profiles/profile-project-presence'
import {
  flushActiveProfileBeforeFileMutation,
  flushActiveProfileBeforeRelaunch
} from '../occ-profiles/profile-persistence-deadline'
import { normalizeExecutionHostId } from '../../shared/execution-host'
import {
  createCloudLinkedOCCProfile,
  connectCurrentOCCProfile,
  getCurrentOCCProfileAuthStatus,
  refreshCurrentOCCProfileAuth,
  selectCurrentOCCProfileOrg,
  signOutCurrentOCCProfile
} from '../occ-profiles/profile-cloud-service'
import { registerOCCProfileOrgMemberHandlers } from './occ-profile-org-members-handlers'
import { onOCCCloudSessionInvalidated } from '../occ-profiles/profile-cloud-session-invalidation'
import {
  broadcastOCCProfileAuthStatusChanged,
  broadcastOCCProfileSignInProgressChanged
} from './occ-profile-auth-status-broadcast'
import {
  cancelOCCCloudSignIn,
  getOCCCloudSignInProgress,
  onOCCCloudSignInProgressChanged
} from '../occ-profiles/profile-cloud-sign-in-progress'
import { profileIdFromArgs } from './occ-profile-id-arg'
import { transferProjectArgsFromUnknown } from './occ-profile-project-transfer-args'

type RegisterOCCProfileHandlersOptions = {
  onBeforeRelaunch?: () => void | Promise<void>
  onAuthMutation?: () => void
  onBeforeSignOut?: () => void
  onAfterSignOut?: () => void
}

function findProjectsByPathArgsFromUnknown(args: unknown): FindOCCProfileProjectsByPathArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_occ_profile_project_path')
  }
  const candidate = args as FindOCCProfileProjectsByPathArgs
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  if (!path) {
    throw new Error('invalid_occ_profile_project_path')
  }
  let executionHostId: FindOCCProfileProjectsByPathArgs['executionHostId'] = null
  if (candidate.executionHostId !== null && candidate.executionHostId !== undefined) {
    if (typeof candidate.executionHostId !== 'string') {
      throw new Error('invalid_occ_profile_project_path')
    }
    executionHostId = normalizeExecutionHostId(candidate.executionHostId)
    if (!executionHostId) {
      throw new Error('invalid_occ_profile_project_path')
    }
  }
  return {
    path,
    connectionId:
      typeof candidate.connectionId === 'string' ? candidate.connectionId.trim() || null : null,
    executionHostId,
    excludeProfileId:
      typeof candidate.excludeProfileId === 'string'
        ? candidate.excludeProfileId.trim() || null
        : null
  }
}

function orgIdFromUnknown(args: unknown): string {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_occ_profile_org_selection')
  }
  const orgId = (args as SelectOCCProfileOrgArgs).orgId?.trim()
  if (!orgId) {
    throw new Error('invalid_occ_profile_org_selection')
  }
  return orgId
}

function createCloudLinkedProfileArgsFromUnknown(args: unknown): CreateCloudLinkedOCCProfileArgs {
  if (!args || typeof args !== 'object') {
    return {}
  }
  const candidate = args as CreateCloudLinkedOCCProfileArgs
  const orgId = typeof candidate.orgId === 'string' ? candidate.orgId.trim() : undefined
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : undefined
  return {
    ...(orgId ? { orgId } : {}),
    ...(name ? { name } : {})
  }
}

async function runBeforeProfileRelaunch(
  onBeforeRelaunch?: () => void | Promise<void>
): Promise<void> {
  try {
    await onBeforeRelaunch?.()
  } catch (error) {
    console.warn(
      '[occ-profiles] Pre-relaunch cleanup failed; continuing profile switch:',
      error instanceof Error ? error.name : typeof error
    )
  }
}

type ProfileRelaunchReason = Extract<AppRelaunchReason, `profile-${string}`>

function scheduleProfileRelaunch(reason: ProfileRelaunchReason, sender: WebContents): void {
  if (!sender.isDestroyed()) {
    sender.send('app:restart-committed')
  }
  setTimeout(() => {
    relaunchApp(reason)
    // Normal quit preserves renderer scrollback, PTY teardown, stats flush and final daemon checkpoints.
    quitProcess()
  }, 150)
}

export function registerOCCProfileHandlers(
  store: Store,
  options: RegisterOCCProfileHandlersOptions = {}
): void {
  ipcMain.handle('occProfiles:list', (): OCCProfileListResult => ({
    ...getOCCProfileListState(),
    multiProfileUi: isMultiProfileUiEnabled()
  }))

  ipcMain.handle('occProfiles:authStatus', (): OCCProfileAuthStatus =>
    getCurrentOCCProfileAuthStatus(getProfileUserDataPath())
  )

  // Push background invalidation; re-entering onAuthMutation would loop into the relay coordinator that just failed.
  onOCCCloudSessionInvalidated(broadcastOCCProfileAuthStatusChanged)
  onOCCCloudSignInProgressChanged(broadcastOCCProfileSignInProgressChanged)

  ipcMain.handle(
    'occProfiles:createLocal',
    (_event, args?: CreateLocalOCCProfileArgs): CreateLocalOCCProfileResult => {
      const result = createLocalOCCProfile(args)
      seedNewOCCProfileTelemetryConsent(result.profile.id, store.getSettings().telemetry)
      return result
    }
  )

  ipcMain.handle(
    'occProfiles:switch',
    async (event, args: SwitchOCCProfileArgs): Promise<SwitchOCCProfileResult> => {
      const profileId = profileIdFromArgs(args)
      const current = getOCCProfileListState()
      if (profileId === current.activeProfileId) {
        return { status: 'already-active' }
      }

      // Flush the source profile before switching the startup index; keep its writer alive through relaunch cleanup.
      await flushActiveProfileBeforeRelaunch(store)
      setActiveOCCProfile(profileId)
      await runBeforeProfileRelaunch(options.onBeforeRelaunch)

      scheduleProfileRelaunch('profile-switch', event.sender)

      return { status: 'relaunching' }
    }
  )

  ipcMain.handle(
    'occProfiles:transferProject',
    async (
      event,
      rawArgs: TransferOCCProfileProjectArgs
    ): Promise<TransferOCCProfileProjectResult> => {
      const args = transferProjectArgsFromUnknown(rawArgs)
      const current = getOCCProfileListState()
      if (args.targetProfileId === current.activeProfileId) {
        throw new Error('active_target_occ_profile_transfer_requires_relaunch')
      }
      if (args.mode === 'move' && args.sourceProfileId === current.activeProfileId) {
        // Finish transfer before relaunch side effects so validation failure cannot strand the app quitting.
        const result = await transferActiveProfileProject(
          args,
          getProfileUserDataPath(),
          store,
          async () => {
            await runBeforeProfileRelaunch(options.onBeforeRelaunch)
            scheduleProfileRelaunch('profile-transfer', event.sender)
          }
        )
        if (result.status === 'transferred') {
          await runBeforeProfileRelaunch(options.onBeforeRelaunch)
          try {
            setActiveOCCProfile(args.targetProfileId)
          } finally {
            // The source has already changed and its writer cannot resume.
            scheduleProfileRelaunch('profile-transfer', event.sender)
          }
          return { ...result, willRelaunch: true }
        }
        return result
      }
      if (args.sourceProfileId !== current.activeProfileId) {
        await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
        return transferOCCProfileProject(args, getProfileUserDataPath())
      }
      const maintenance = await flushActiveProfileBeforeFileMutation(store)
      try {
        return transferOCCProfileProject(args, getProfileUserDataPath())
      } finally {
        await maintenance.resume()
      }
    }
  )

  ipcMain.handle(
    'occProfiles:findProjectProfiles',
    (_event, rawArgs: FindOCCProfileProjectsByPathArgs): FindOCCProfileProjectsByPathResult =>
      findOCCProfileProjectsByPath(
        findProjectsByPathArgsFromUnknown(rawArgs),
        getProfileUserDataPath()
      )
  )

  ipcMain.handle(
    'occProfiles:connectCurrent',
    async (): Promise<ConnectCurrentOCCProfileResult> => {
      const result = await connectCurrentOCCProfile(getProfileUserDataPath())
      if (result.status === 'connected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle('occProfiles:signInProgress', (): OCCCloudSignInProgress | null =>
    getOCCCloudSignInProgress()
  )

  ipcMain.handle('occProfiles:cancelSignIn', (): void => cancelOCCCloudSignIn())

  ipcMain.handle(
    'occProfiles:createCloudLinked',
    async (
      _event,
      rawArgs?: CreateCloudLinkedOCCProfileArgs
    ): Promise<CreateCloudLinkedOCCProfileResult> => {
      const result = await createCloudLinkedOCCProfile(
        getProfileUserDataPath(),
        createCloudLinkedProfileArgsFromUnknown(rawArgs)
      )
      if (result.status === 'created') {
        seedNewOCCProfileTelemetryConsent(result.profile.id, store.getSettings().telemetry)
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'occProfiles:refreshAuth',
    async (): Promise<RefreshCurrentOCCProfileAuthResult> => {
      const result = await refreshCurrentOCCProfileAuth(getProfileUserDataPath())
      if (result.status === 'refreshed') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'occProfiles:signOutCurrent',
    async (): Promise<SignOutCurrentOCCProfileResult> => {
      options.onBeforeSignOut?.()
      return signOutCurrentOCCProfile(getProfileUserDataPath()).finally(options.onAfterSignOut)
    }
  )

  ipcMain.handle(
    'occProfiles:selectOrg',
    async (_event, rawArgs: SelectOCCProfileOrgArgs): Promise<SelectOCCProfileOrgResult> => {
      const result = await selectCurrentOCCProfileOrg(
        getProfileUserDataPath(),
        orgIdFromUnknown(rawArgs)
      )
      if (result.status === 'selected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  registerOCCProfileOrgMemberHandlers()
}
