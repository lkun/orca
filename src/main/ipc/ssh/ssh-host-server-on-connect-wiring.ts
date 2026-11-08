import { getAppEnvironment } from '../../../shared/app-environment'
import {
  getManagedOCCdFenceEnvironmentId,
  managedOCCdServerName
} from '../../../shared/managed-occd-ssh-owner'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { findOCCdMigrationSourceCutoverForTarget } from '../../ssh/occd-migration-cutover-journal'
import { abandonOCCdConversion } from '../../ssh/occd-conversion-abandon'
import { retainOCCdMigrationSource } from '../../ssh/occd-migration-source-retention'
import { enableMovedOCCdAutomationsForTarget } from '../../ssh/occd-migration-moved-automations'
import { hasOCCdTemplate } from '../../occd/occd-artifact-materializer'
import { isOCCdHostUnavailableFixableOnHost } from '../../occd/occd-host-unavailable'
import { managedServerUpdateDeps } from '../../ssh/managed-server-update-deps'
import { ensureOCCdManagedTunnel } from '../../managed-server/lifecycle/occd-managed-tunnel'
import { verifyOCCdManagedServing } from '../../managed-server/lifecycle/occd-managed-serving-verify'
import { convertSshTargetToManagedOCCd } from '../../managed-server/lifecycle/occd-runtime-conversion'
import {
  occdMigrationDestinationFor,
  occdServerAutomationEnablerFor,
  occdServerFolderCatalogFor,
  occdServerRepositoriesFor
} from '../../managed-server/lifecycle/occd-runtime-conversion-wiring'
import { createManagedOCCdEnvironment } from '../../managed-server/lifecycle/occd-runtime-deployment'
import type { HostServerOnConnectDeps } from '../../ssh/ssh-host-server-on-connect'
import {
  censusSshHostRelaysBeforeSession,
  relayTerminalsOnConnect
} from '../../ssh/legacy-relay/ssh-host-relay-terminals-on-connect'
import { requireManagedOCCdInfrastructure } from '../../managed-server/lifecycle/occd-managed-runtime-context'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import { setSshHostServerStatus } from '../../ssh/ssh-host-server-status'
import { trackSshHostServerEvent } from '../../ssh/ssh-host-server-telemetry'
import { knownSshHostPlatform } from '../../ssh/ssh-host-platform-memo'
import { knownOCCdTunnelTransport } from '../../ssh/occd-tunnel-transport-memo'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { releaseUnreachableOCCdSetup } from '../../ssh/occd-unreachable-setup-release'
import { getCurrentMainWindow } from './ssh-ipc-context'
import { broadcastSshState } from './ssh-renderer-broadcast'
import { connectInFlight } from './ssh-connect-attempt-registry'
import { startLegacyRelayBridge } from '../../ssh/legacy-relay/legacy-relay-bridge-registry'
import { isBridgeableLease } from '../../ssh/legacy-relay/legacy-relay-bridge-leases'

export function hostServerOnConnectDeps(userDataPath: string): HostServerOnConnectDeps {
  const registry = getSshTargetRegistryStore()!
  const claims = registry.getOCCdRuntimeClaims()
  const store = registry.getOCCdMigrationSource()
  const appVersion = getAppEnvironment().getVersion()
  const isRegistered = (environmentId: string): boolean =>
    listEnvironments(userDataPath).some((entry) => entry.id === environmentId)
  return {
    // A fence alone may be unfinished setup; only registered servers count.
    managedEnvironmentId: (target) => {
      const environmentId = getManagedOCCdFenceEnvironmentId(target)
      return environmentId && isRegistered(environmentId) ? environmentId : null
    },
    ensureTunnel: async (environmentId) => {
      await ensureOCCdManagedTunnel(userDataPath, environmentId)
    },
    ensureServing: (environmentId) => verifyOCCdManagedServing(userDataPath, environmentId),
    retainCommittedSource: async (target) => {
      const head = findOCCdMigrationSourceCutoverForTarget(userDataPath, target.id)
      if (head?.phase !== 'destination-committed') {
        return 0
      }
      await retainOCCdMigrationSource(userDataPath, head.migrationId, store)
      // Retry what earlier connects could not reach the server to re-enable.
      const environment = listEnvironments(userDataPath).find(
        (entry) => entry.id === head.destinationEnvironmentId
      )
      return environment
        ? enableMovedOCCdAutomationsForTarget(
            userDataPath,
            target.id,
            occdServerAutomationEnablerFor(environment)
          )
        : 0
    },
    hasTemplate: hasOCCdTemplate,
    recordedUnavailable: (target) =>
      target.managedServerUnavailable?.appVersion === appVersion
        ? target.managedServerUnavailable.reason
        : null,
    recordUnavailable: (target, reason) => {
      if (!isOCCdHostUnavailableFixableOnHost(reason)) {
        registry.updateTarget(target.id, { managedServerUnavailable: { reason, appVersion } })
      }
    },
    ...managedServerUpdateDeps(userDataPath),
    isEmptyHost: (target) => {
      // An interrupted empty-host deploy passes its own claim, recorded by its provisioning intent.
      const environmentId = getManagedOCCdFenceEnvironmentId(target)
      return claims.preflight(
        target.id,
        environmentId
          ? { environmentId, recorded: target.occdProvisioning !== undefined }
          : undefined
      ).claimable
    },
    relayTerminals: (target) =>
      relayTerminalsOnConnect({
        store,
        targetId: target.id,
        censusHost: async () =>
          censusSshHostRelaysBeforeSession(
            await requireManagedOCCdInfrastructure().connectionManager.connect(target),
            target.id
          )
      }),
    deploy: (target) =>
      createManagedOCCdEnvironment(userDataPath, {
        name: target.occdProvisioning?.name ?? managedOCCdServerName(target),
        sshTargetId: target.id
      }),
    convert: async (target, hostProof) => {
      // COMPAT(legacy-relay-bridge): find the panes old relays still run before the tabs remount.
      if (hostProof?.bridged) {
        await startLegacyRelayBridge(target.id)
      }
      const converted = await convertSshTargetToManagedOCCd(userDataPath, {
        sshTargetId: target.id,
        name: managedOCCdServerName(target),
        // The connect's own census already answered; a conversion before any session reuses it.
        censusHost: (host) =>
          hostProof ? Promise.resolve(hostProof) : censusHostRelayTerminalsFor(host)(),
        isBridgedPaneLease: isBridgeableLease,
        // Releasing the direct session here would cancel the connect that requested conversion.
        destinationFor: occdMigrationDestinationFor,
        serverRepositoriesFor: occdServerRepositoriesFor,
        serverFolderCatalogFor: occdServerFolderCatalogFor,
        serverAutomationEnablerFor: occdServerAutomationEnablerFor
      })
      // A quiet retry's refusal is not the user's attempt, so it keeps their consent.
      const quiet = connectInFlight.get(target.id)?.quiet?.active === true
      if (converted.outcome === 'converted' || (converted.outcome === 'refused' && !quiet)) {
        // Move-anyway consent covers one attempt; retain it on failure so held-fence verification can resume.
        registry.updateTarget(target.id, { managedServerLeaveBehind: undefined })
      }
      return converted
    },
    abandonDeploy: async (target) => {
      const environmentId =
        getManagedOCCdFenceEnvironmentId(target) ??
        getManagedOCCdFenceEnvironmentId(registry.getTarget(target.id))
      if (environmentId && !isRegistered(environmentId)) {
        claims.release(target.id, environmentId)
        await claims.flush()
      }
    },
    hasUnfinishedConversion: (target) => {
      const head = findOCCdMigrationSourceCutoverForTarget(userDataPath, target.id)
      return (
        head !== null &&
        !head.supersedesMigrationId &&
        (head.phase === 'source-fenced' || head.phase === 'destination-staged')
      )
    },
    abandonConversion: async (target) => {
      await abandonOCCdConversion({
        userDataPath,
        store,
        claims,
        targetId: target.id,
        destinationFor: occdMigrationDestinationFor
      })
    },
    isFencedBeforeStaging: (target) =>
      findOCCdMigrationSourceCutoverForTarget(userDataPath, target.id)?.phase === 'source-fenced',
    releaseUnreachableSetup: (target) =>
      releaseUnreachableOCCdSetup({ userDataPath, claims, targetId: target.id }),
    // Read at report time: a deploy or conversion learns the platform while the decision runs.
    report: (target, event) =>
      trackSshHostServerEvent(
        event,
        knownSshHostPlatform(target.id),
        knownOCCdTunnelTransport(target.id)
      ),
    progress: (target, phase) => {
      // Cancelled decisions keep running; their progress must not revive connection status.
      const attempt = connectInFlight.get(target.id)
      if (!attempt || attempt.quiet?.active) {
        return
      }
      setSshHostServerStatus(target.id, { kind: 'setting-up', phase })
      broadcastSshState(getCurrentMainWindow, target.id, {
        targetId: target.id,
        status: 'connecting',
        error: null,
        reconnectAttempt: 0
      })
    }
  }
}
