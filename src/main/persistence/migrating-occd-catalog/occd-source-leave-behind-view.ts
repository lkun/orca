// Offer "Move anyway" only when a consent-free preview shows it clears the blockers.
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import { collectOCCdMigrationUntransferredDependencyCensus } from './occd-source-dependency-census'
import { collectOCCdMigrationSourceDormantState } from './occd-source-dormant-state'
import type { OCCdMigrationDeltaView } from './occd-source-delta-view'

export function createOCCdMigrationLeaveBehindView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  targetId: string
): OCCdMigrationDeltaView {
  // Read-only collectors make a shallow copy sufficient.
  const state = {
    ...runtime.state,
    sshTargets: runtime.state.sshTargets.map((target) =>
      target.id === targetId
        ? { ...target, managedServerLeaveBehind: { confirmedAt: new Date(0).toISOString() } }
        : target
    )
  }
  const storage = runtime.terminalScrollbackSnapshotStorage
  return {
    getRepos: () => state.repos,
    getFolderWorkspaces: () => state.folderWorkspaces,
    getProjectGroups: () => state.projectGroups,
    collectOCCdMigrationSourceDormantState: (source, catalog, destinationEnvironmentId) =>
      collectOCCdMigrationSourceDormantState(
        state,
        source,
        catalog,
        storage,
        destinationEnvironmentId
      ).payload,
    inspectOCCdMigrationUntransferredDependencies: (manifest) =>
      collectOCCdMigrationUntransferredDependencyCensus(state, manifest, storage)
  }
}
