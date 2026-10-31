// Export only additions from older builds by subtracting prior migrations from a profile copy.
import type {
  OCCdMigrationCatalogPayload,
  OCCdMigrationDormantStatePayload,
  OCCdMigrationManifest,
  OCCdMigrationManifestSource
} from '../../../shared/occd-migration/occd-migration-manifest'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import { subtractOCCdSourceCatalogState } from './occd-source-catalog-subtraction'
import {
  collectOCCdMigrationUntransferredDependencyCensus,
  type OCCdMigrationSourceDependencyCensus
} from './occd-source-dependency-census'
import { subtractOCCdMigrationSourceDormantState } from './occd-source-dormant-subtraction'
import { collectOCCdMigrationSourceDormantState } from './occd-source-dormant-state'
import { subtractOCCdMigrationScopeWorkspaceSession } from './occd-source-workspace-session-subtraction'

export type OCCdMigrationDeltaView = {
  getRepos: () => Repo[]
  getFolderWorkspaces: () => FolderWorkspace[]
  getProjectGroups: () => ProjectGroup[]
  collectOCCdMigrationSourceDormantState: (
    source: OCCdMigrationManifestSource,
    catalog: OCCdMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ) => OCCdMigrationDormantStatePayload
  inspectOCCdMigrationUntransferredDependencies: (
    manifest: OCCdMigrationManifest
  ) => OCCdMigrationSourceDependencyCensus
}

/** moved includes today's edits to previously migrated rows. */
export function createOCCdMigrationDeltaView(
  runtime: Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage'>,
  moved: OCCdMigrationManifest
): OCCdMigrationDeltaView {
  const state = structuredClone(runtime.state)
  subtractOCCdSourceCatalogState(state, moved)
  subtractOCCdMigrationSourceDormantState(state, moved)
  // The server owns the moved projects' tabs now, even ones the older build left unmovable.
  subtractOCCdMigrationScopeWorkspaceSession(state, moved)
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
