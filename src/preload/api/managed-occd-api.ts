/** Managed occd servers over SSH; desktop-only, so web clients leave it undefined. */
import { ipcRenderer } from 'electron'
import type {
  OCCdDeltaMovePreview,
  OCCdDeltaMoveResult,
  OCCdManagedCancelStopResult,
  OCCdManagedConversionResult,
  OCCdManagedDeployResult,
  OCCdManagedForgetResult,
  OCCdManagedPastLiveTerminals,
  OCCdManagedPendingMigrationRow,
  OCCdManagedRecoveryResult,
  OCCdManagedRestartResult,
  OCCdManagedStaleLockReclaimRequest,
  OCCdManagedStaleLockReclaimResult,
  OCCdManagedRollbackResult,
  OCCdManagedRuntimeStatus,
  OCCdManagedStopResult
} from '../../shared/occd-managed-runtime'
import type { PublicKnownRuntimeEnvironment } from '../../shared/runtime-environments'
import type {
  RuntimeSshAccessLinkRequest,
  RuntimeSshAccessUnlinkRequest
} from '../../shared/runtime-ssh-access'

export type ManagedOCCdPreloadApi = {
  deploy: (args: {
    name: string
    sshTargetId: string
    force?: boolean
  }) => Promise<OCCdManagedDeployResult>
  getStatus: (args: { selector: string }) => Promise<OCCdManagedRuntimeStatus>
  update: (args: {
    selector: string
    force?: boolean
    pastLiveTerminals?: OCCdManagedPastLiveTerminals
  }) => Promise<OCCdManagedDeployResult>
  rollback: (args: { selector: string }) => Promise<OCCdManagedRollbackResult>
  recover: (args: {
    selector: string
    /** Restore the snapshot over state a rejected build changed; see OCCD_RECOVERY_CHANGED_STATE_CODE. */
    acceptChangedState?: boolean
  }) => Promise<OCCdManagedRecoveryResult>
  /** Restarts from this client's SSH session; refused while terminals run. */
  restart: (args: { selector: string }) => Promise<OCCdManagedRestartResult>
  /** Without `yes`, only reports whether the host's instance lock may be cleared. */
  reclaimStaleLock: (
    args: { selector: string } & OCCdManagedStaleLockReclaimRequest
  ) => Promise<OCCdManagedStaleLockReclaimResult>
  stop: (args: { selector: string }) => Promise<OCCdManagedStopResult>
  cancelStop: (args: { selector: string }) => Promise<OCCdManagedCancelStopResult>
  forget: (args: { selector: string }) => Promise<OCCdManagedForgetResult>
  linkSshAccess: (args: RuntimeSshAccessLinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  unlinkSshAccess: (args: RuntimeSshAccessUnlinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  convertSshHost: (args: {
    sshTargetId: string
    name: string
  }) => Promise<OCCdManagedConversionResult>
  listPendingMigrations: () => Promise<OCCdManagedPendingMigrationRow[]>
  previewDeltaMove: (args: { sshTargetId: string }) => Promise<OCCdDeltaMovePreview>
  moveDelta: (args: { sshTargetId: string }) => Promise<OCCdDeltaMoveResult>
  keepServerVersion: (args: { sshTargetId: string }) => Promise<void>
  /** "Move anyway": the next connect leaves what can't move on this desktop. */
  allowMoveLeavingBehind: (args: { sshTargetId: string }) => Promise<void>
}

export const managedOCCdApi: ManagedOCCdPreloadApi = {
  deploy: (args) => ipcRenderer.invoke('runtimeEnvironments:deployOCCd', args),
  getStatus: (args) => ipcRenderer.invoke('runtimeEnvironments:getOCCdStatus', args),
  update: (args) => ipcRenderer.invoke('runtimeEnvironments:updateOCCd', args),
  rollback: (args) => ipcRenderer.invoke('runtimeEnvironments:rollbackOCCd', args),
  recover: (args) => ipcRenderer.invoke('runtimeEnvironments:recoverOCCd', args),
  restart: (args) => ipcRenderer.invoke('runtimeEnvironments:restartOCCd', args),
  reclaimStaleLock: (args) => ipcRenderer.invoke('runtimeEnvironments:reclaimOCCdStaleLock', args),
  stop: (args) => ipcRenderer.invoke('runtimeEnvironments:stopOCCd', args),
  cancelStop: (args) => ipcRenderer.invoke('runtimeEnvironments:cancelOCCdStop', args),
  forget: (args) => ipcRenderer.invoke('runtimeEnvironments:forgetOCCd', args),
  linkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:linkSshAccess', args),
  unlinkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:unlinkSshAccess', args),
  convertSshHost: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:convertSshHostToManagedOCCd', args),
  listPendingMigrations: () => ipcRenderer.invoke('runtimeEnvironments:listPendingOCCdMigrations'),
  previewDeltaMove: (args) => ipcRenderer.invoke('runtimeEnvironments:previewOCCdDeltaMove', args),
  moveDelta: (args) => ipcRenderer.invoke('runtimeEnvironments:moveOCCdDelta', args),
  keepServerVersion: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:keepOCCdServerVersion', args),
  allowMoveLeavingBehind: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:allowOCCdMoveLeavingBehind', args)
}
