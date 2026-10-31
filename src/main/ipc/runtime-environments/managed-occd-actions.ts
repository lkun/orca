import {
  cancelManagedOCCdStop,
  forgetManagedOCCdEnvironment,
  stopManagedOCCdEnvironment
} from '../../managed-server/lifecycle/occd-runtime-decommission'
import { getManagedOCCdRuntimeStatus } from '../../managed-server/lifecycle/occd-runtime-status'
import {
  recoverManagedOCCdEnvironment,
  rollbackManagedOCCdEnvironment,
  updateManagedOCCdEnvironment
} from '../../ssh/occd-runtime-maintenance'
import { getOCCdSshDeployment } from '../../../shared/runtime-environments'
import { resolveEnvironment } from '../../../shared/runtime-environment-store'
import type {
  OCCdManagedRestartResult,
  OCCdManagedStaleLockReclaimRequest,
  OCCdManagedStaleLockReclaimResult
} from '../../../shared/occd-managed-runtime'
import { restartManagedOCCdEnvironment } from '../../managed-server/lifecycle/occd-managed-launch-session'
import { runManagedOCCdStaleLockReclaim } from '../../managed-server/lifecycle/occd-managed-stale-lock-reclaim'
import { clearLaunchSessionNote } from './runtime-environment-managed-tunnel'
import { forgetLaunchSessionVerdict } from '../ssh/ssh-host-launch-session-note'
import type { ManagedServerActions } from '../../runtime/managed-server-actions-registry'
import {
  retireRemovedRuntimeEnvironment,
  type RemovedServerStore
} from './runtime-environment-removal-cleanup'

export type ManagedOCCdActionOptions = {
  getUserDataPath: () => string
  getActiveEnvironmentId: () => string | null | undefined
  invalidateTransport: (environmentId: string) => Promise<void> | void
  clearHostServerNotes: (sshTargetId: string, environmentId: string) => void
  clearHostServerStatus: (sshTargetId: string) => void
  store: RemovedServerStore
}

export function createManagedOCCdActions(
  options: ManagedOCCdActionOptions
): ManagedServerActions {
  const userDataPath = options.getUserDataPath
  const unlinkPolicy = {
    isActiveEnvironment: (environmentId: string) =>
      options.getActiveEnvironmentId() === environmentId,
    retireLocalState: (environmentId: string) =>
      retireRemovedRuntimeEnvironment(
        environmentId,
        options.invalidateTransport,
        options.store,
        userDataPath()
      )
  }
  return {
    status: (selector) => getManagedOCCdRuntimeStatus(userDataPath(), selector),
    update: async (selector, force, pastLiveTerminals) => {
      const result = await updateManagedOCCdEnvironment(userDataPath(), {
        selector,
        force,
        ...(pastLiveTerminals ? { pastLiveTerminals } : {})
      })
      if (result.outcome === 'updated') {
        await options.invalidateTransport(result.environment.id)
      }
      if (result.outcome !== 'deferred') {
        const targetId = getOCCdSshDeployment(result.environment)?.sshTargetId
        if (targetId) {
          options.clearHostServerNotes(targetId, result.environment.id)
        }
      }
      return result
    },
    rollback: async (selector) => {
      const result = await rollbackManagedOCCdEnvironment(userDataPath(), { selector })
      if (result.outcome === 'rolled-back') {
        await options.invalidateTransport(result.environment.id)
      }
      return result
    },
    recover: async (selector, acceptChangedState) => {
      const result = await recoverManagedOCCdEnvironment(userDataPath(), {
        selector,
        acceptChangedState: acceptChangedState === true
      })
      if (result.outcome === 'recovered' && result.activeVersion) {
        await options.invalidateTransport(result.environment.id)
      }
      return result
    },
    stop: async (selector) => {
      const result = await stopManagedOCCdEnvironment(userDataPath(), { selector }, unlinkPolicy)
      if (result.outcome === 'unlinked') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    },
    cancelStop: (selector) => cancelManagedOCCdStop(userDataPath(), { selector }),
    forget: async (selector) => {
      const result = await forgetManagedOCCdEnvironment(userDataPath(), { selector }, unlinkPolicy)
      if (result.outcome === 'forgotten') {
        options.clearHostServerStatus(result.sshTargetId)
      }
      return result
    }
  }
}

export async function restartManagedOCCd(
  options: ManagedOCCdActionOptions,
  selector: string
): Promise<OCCdManagedRestartResult> {
  const result = await restartManagedOCCdEnvironment(options.getUserDataPath(), selector)
  if (result.outcome === 'restarted') {
    await reconnectRestartedManagedOCCd(options, result.environmentId)
  }
  return result
}

export async function reclaimManagedOCCdStaleLock(
  options: ManagedOCCdActionOptions,
  selector: string,
  request: OCCdManagedStaleLockReclaimRequest
): Promise<OCCdManagedStaleLockReclaimResult> {
  const result = await runManagedOCCdStaleLockReclaim(options.getUserDataPath(), selector, request)
  // Reconnect also replaces stale-lock feedback when no process had started.
  if (result.status === 'reclaimed') {
    await reconnectRestartedManagedOCCd(options, result.environmentId)
  }
  return result
}

async function reconnectRestartedManagedOCCd(
  options: ManagedOCCdActionOptions,
  environmentId: string
): Promise<void> {
  await options.invalidateTransport(environmentId)
  const environment = resolveEnvironment(options.getUserDataPath(), environmentId)
  const targetId = getOCCdSshDeployment(environment)?.sshTargetId
  if (targetId) {
    options.clearHostServerNotes(targetId, environmentId)
    forgetLaunchSessionVerdict(targetId)
    clearLaunchSessionNote(targetId, environmentId)
  }
}
