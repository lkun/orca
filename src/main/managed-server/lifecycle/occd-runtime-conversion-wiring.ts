import { encodePairingOffer } from '../../../shared/pairing'
import {
  getPreferredPairingOffer,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { disconnectRegisteredSshTarget } from '../../ipc/ssh/ssh-session-teardown'
import type { OCCdMigrationDestinationCatalog } from '../../ssh/occd-migration-cutover-coordinator'
import {
  abortRemoteOCCdMigrationCatalog,
  commitRemoteOCCdMigrationCatalog,
  listRemoteOCCdRepositories,
  readRemoteOCCdMigrationCatalogState,
  stageRemoteOCCdMigrationCatalog,
  stageRemoteOCCdMigrationSnapshotChunk
} from '../../ssh/occd-migration-catalog-client'
import { abortRemoteOCCdMigrationCatalogByReference } from '../../ssh/occd-migration-catalog-reference-client'
import {
  enableRemoteOCCdAutomation,
  type EnableServerAutomation
} from '../../ssh/occd-migration-moved-automations'
import { censusHostRelayTerminalsFor } from '../../ssh/legacy-relay/ssh-host-relay-census-for-target'
import { isBridgeableLease } from '../../ssh/legacy-relay/legacy-relay-bridge-leases'
import type { OCCdManagedConversionArgs } from './occd-runtime-conversion'
import type { OCCdServerRepository } from '../../ssh/occd-migration-repository-link'
import {
  listRemoteOCCdFolderCatalog,
  type OCCdServerFolderCatalog
} from '../../ssh/occd-server-folder-workspaces'

export function occdMigrationDestinationFor(
  environment: KnownRuntimeEnvironment
): OCCdMigrationDestinationCatalog {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  const options = environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  return {
    readState: (manifest) => readRemoteOCCdMigrationCatalogState(pairingCode, manifest, options),
    stage: (manifest) => stageRemoteOCCdMigrationCatalog(pairingCode, manifest, options),
    commit: (manifest) => commitRemoteOCCdMigrationCatalog(pairingCode, manifest, options),
    abort: (manifest) => abortRemoteOCCdMigrationCatalog(pairingCode, manifest, options),
    abortByReference: (manifest) =>
      abortRemoteOCCdMigrationCatalogByReference(pairingCode, manifest, options),
    stageChunk: (request) => stageRemoteOCCdMigrationSnapshotChunk(pairingCode, request, options)
  }
}

export function occdServerRepositoriesFor(
  environment: KnownRuntimeEnvironment
): Promise<OCCdServerRepository[]> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteOCCdRepositories(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function occdServerFolderCatalogFor(
  environment: KnownRuntimeEnvironment
): Promise<OCCdServerFolderCatalog> {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  return listRemoteOCCdFolderCatalog(
    pairingCode,
    environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  )
}

export function occdServerAutomationEnablerFor(
  environment: KnownRuntimeEnvironment
): EnableServerAutomation {
  const pairingCode = encodePairingOffer(getPreferredPairingOffer(environment))
  const options = environment.runtimeId ? { expectedRuntimeId: environment.runtimeId } : {}
  return (automation) => enableRemoteOCCdAutomation(pairingCode, automation, options)
}

export function conversionCollaborators(): Pick<
  OCCdManagedConversionArgs,
  | 'destinationFor'
  | 'serverRepositoriesFor'
  | 'serverFolderCatalogFor'
  | 'serverAutomationEnablerFor'
  | 'censusHost'
  | 'isBridgedPaneLease'
  | 'releaseDirectSession'
> {
  return {
    destinationFor: occdMigrationDestinationFor,
    serverRepositoriesFor: occdServerRepositoriesFor,
    serverFolderCatalogFor: occdServerFolderCatalogFor,
    serverAutomationEnablerFor: occdServerAutomationEnablerFor,
    censusHost: (target) => censusHostRelayTerminalsFor(target)(),
    isBridgedPaneLease: isBridgeableLease,
    releaseDirectSession: disconnectRegisteredSshTarget
  }
}
