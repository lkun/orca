/** IPC for a host an older build changed after conversion: move its newer projects, or keep the server's. */
import { ipcMain } from 'electron'
import type {
  OCCdDeltaMovePreview,
  OCCdDeltaMoveResult
} from '../../../shared/occd-managed-runtime'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { requireManagedOCCdInfrastructure } from '../../managed-server/lifecycle/occd-managed-runtime-context'
import { ensureOCCdManagedTunnel } from '../../managed-server/lifecycle/occd-managed-tunnel'
import { keepOCCdServerVersion, runOCCdDeltaMove } from '../../ssh/occd-migration-delta-move'
import { planOCCdDeltaMove } from '../../ssh/occd-migration-delta-plan'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import {
  occdMigrationDestinationFor,
  occdServerAutomationEnablerFor
} from '../../managed-server/lifecycle/occd-runtime-conversion-wiring'
import { enableMovedOCCdAutomationsForTarget } from '../../ssh/occd-migration-moved-automations'
import { requiredString } from './occd-runtime-lifecycle-handlers'
import { publishResolvedChangedHostStatus } from './runtime-environment-managed-tunnel'
import { runTargetLifecycle } from '../ssh/ssh-target-lifecycle-queue'

export function registerOCCdDeltaMoveHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:previewOCCdDeltaMove',
    (_event, args: { sshTargetId: string }): OCCdDeltaMovePreview => {
      const { store, target } = requireChangedHost(args)
      const plan = planOCCdDeltaMove(getUserDataPath(), store, target)
      const { sshTargetId, environmentId, added, notReflected, blockers } = plan
      return { sshTargetId, environmentId, added, notReflected, blockers }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:moveOCCdDelta',
    async (_event, args: { sshTargetId: string }): Promise<OCCdDeltaMoveResult> => {
      const userDataPath = getUserDataPath()
      const { store, claims, target } = requireChangedHost(args)
      const environment = listEnvironments(userDataPath).find(
        (entry) => entry.id === target.occdFence?.environmentId
      )
      if (!environment) {
        throw new Error('This host’s OCC server is no longer registered.')
      }
      const result = await runOCCdDeltaMove({
        userDataPath,
        store,
        claims,
        target,
        environment,
        connectDestination: async () =>
          occdMigrationDestinationFor(
            await ensureOCCdManagedTunnel(userDataPath, environment.id)
          ),
        censusHost: censusHostRelayTerminalsFor(target),
        runTargetLifecycle
      })
      if (result.outcome === 'moved') {
        // Tunnel repair may have re-paired the server; read its current credentials.
        const paired = listEnvironments(userDataPath).find((entry) => entry.id === environment.id)
        const automationsLeftDisabled = await enableMovedOCCdAutomationsForTarget(
          userDataPath,
          target.id,
          occdServerAutomationEnablerFor(paired ?? environment)
        ).catch((error: unknown) => {
          console.warn('[ssh] Could not re-enable moved automations:', error)
          return 0
        })
        publishResolvedChangedHostStatus(target, environment.id, automationsLeftDisabled)
      }
      return result
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:keepOCCdServerVersion',
    async (_event, args: { sshTargetId: string }): Promise<void> => {
      const { store, claims, target, environmentId } = requireChangedHost(args)
      await runTargetLifecycle(target.id, () =>
        keepOCCdServerVersion({ userDataPath: getUserDataPath(), store, claims, target })
      )
      publishResolvedChangedHostStatus(target, environmentId)
    }
  )
}

function requireChangedHost(args: { sshTargetId: string } | undefined) {
  const sshTargetId = requiredString(args?.sshTargetId, 'SSH target')
  const { targetStore, claims } = requireManagedOCCdInfrastructure()
  const store = targetStore.getOCCdMigrationSource()
  const target = store.getSshTarget(sshTargetId)
  if (!target?.occdFence?.sourceChangedAt) {
    throw new Error('This SSH host has no changes from an older OCC to resolve.')
  }
  return { store, claims, target, environmentId: target.occdFence.environmentId }
}
