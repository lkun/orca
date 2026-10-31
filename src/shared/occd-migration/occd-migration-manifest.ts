import type { FolderWorkspace } from '../folder-workspace-types'
import type { Automation, AutomationRun } from '../automations-types'
import type { OCCdMigrationManifestVersion } from './occd-migration-manifest-validation'
import type { ProjectGroup } from '../project-group-types'
import type { Repo } from '../repo-types'
import type { SparsePreset } from '../worktree/create-types'
import type { WorkspaceLineage, WorktreeLineage } from '../worktree/lineage-types'
import type { WorktreeMeta } from '../worktree/meta-types'
import type { RetiredNameRegistry } from '../worktree/retired-name-registry'
import type { WorkspaceSessionState } from '../workspace-session-state-types'
import type { OCCdMigrationClientStatePayload } from './occd-migration-client-state'
import type {
  OCCdMigrationSnapshotUploadState,
  OCCdMigrationTerminalScrollbackSnapshot
} from './occd-migration-scrollback'
import type { OCCdMigrationBlobUploadState } from './occd-migration-blob-transfer'

import { isRecord } from './occd-migration-manifest-fields'

/** The relay-era SSH source: on the wire it never carries `kind` (see occd-migration-source-kind). */
export type OCCdMigrationSshManifestSource = {
  sshTargetId: string
  sshTargetGeneration: number | null
  targetLabel: string
}

/** Explicit desktop WSL project scope prevents destination path inference; generation orders delta moves. */
export type OCCdMigrationLocalWslManifestSource = {
  kind: 'local-wsl'
  distro: string
  /** The distro's registry id, when known: a re-registered distro of the same name is another one. */
  distroGuid?: string
  scopeRepoIds: string[]
  scopeFolderWorkspaceIds: string[]
  generation: number
}

export type OCCdMigrationManifestSource =
  | OCCdMigrationSshManifestSource
  | OCCdMigrationLocalWslManifestSource

export type OCCdMigrationCatalogPayload = {
  repositories: Repo[]
  projectGroups: ProjectGroup[]
  folderWorkspaces: FolderWorkspace[]
  dormantState?: OCCdMigrationDormantStatePayload
}

export type OCCdMigrationDormantWorktreeMeta = {
  sourceKey: string
  worktreeId: string
  meta: WorktreeMeta
}

export type OCCdMigrationDormantWorktreeLineage = {
  sourceKey: string
  worktreeId: string
  lineage: WorktreeLineage
}

export type OCCdMigrationDormantWorkspaceLineage = {
  sourceKey: string
  childWorkspaceKey: string
  lineage: WorkspaceLineage
}

export type OCCdMigrationDormantRetiredNames = {
  repoId: string
  registry: RetiredNameRegistry
}

export type OCCdMigrationDormantRetirementNamespace = {
  sourceNamespaceKeys: string[]
  namespaceKey: string
  registry: RetiredNameRegistry
}

export type OCCdMigrationDormantStatePayload = {
  version: 1
  worktreeMeta: OCCdMigrationDormantWorktreeMeta[]
  worktreeLineage: OCCdMigrationDormantWorktreeLineage[]
  workspaceLineage: OCCdMigrationDormantWorkspaceLineage[]
  sparsePresets: SparsePreset[]
  retiredWorktreeNames: OCCdMigrationDormantRetiredNames[]
  retiredWorktreeNamespaces: OCCdMigrationDormantRetirementNamespace[]
  workspaceSession?: WorkspaceSessionState
  terminalScrollbackSnapshots?: OCCdMigrationTerminalScrollbackSnapshot[]
  automations?: Automation[]
  automationRuns?: AutomationRun[]
  /** Client-owned durable intent projected to the destination authority. */
  clientState?: OCCdMigrationClientStatePayload
}

export type OCCdMigrationManifest = {
  version: OCCdMigrationManifestVersion
  migrationId: string
  createdAt: string
  source: OCCdMigrationManifestSource
  payload: OCCdMigrationCatalogPayload
  /** Destination runtime identity used to re-key desktop routing after commit. */
  destinationEnvironmentId?: string
  manifestSha256: string
}

export type OCCdMigrationImportReceipt = {
  version: OCCdMigrationManifestVersion
  migrationId: string
  manifestSha256: string
  source: OCCdMigrationManifestSource
  importedAt: string
  repositoryIds: string[]
  projectGroupIds: string[]
  folderWorkspaceIds: string[]
}

export type OCCdMigrationStagedCatalog = {
  version: OCCdMigrationManifestVersion
  manifest: OCCdMigrationManifest
  stagedAt: string
}

export type OCCdMigrationCatalogState =
  | {
      state: 'absent'
      migrationId: string
      manifestSha256: string
    }
  | {
      state: 'staged'
      migrationId: string
      manifestSha256: string
      stagedAt: string
      snapshotUploads?: OCCdMigrationSnapshotUploadState[]
      /** Blobs staged so far; absent from hosts without the blob channel. */
      blobUploads?: OCCdMigrationBlobUploadState[]
    }
  | {
      state: 'committed'
      migrationId: string
      manifestSha256: string
      receipt: OCCdMigrationImportReceipt
    }

export type OCCdMigrationCatalogAbortResult = OCCdMigrationCatalogState & {
  aborted: boolean
  durableAbsent?: true
}

export type OCCdMigrationCatalogReference = Pick<
  OCCdMigrationManifest,
  'migrationId' | 'manifestSha256'
>

/** An abort by reference: no receipt, since an evicted one is rebuilt only from the manifest. */
export type OCCdMigrationCatalogReferenceAbortResult = OCCdMigrationCatalogReference & {
  state: 'absent' | 'committed'
  aborted: boolean
  durableAbsent?: true
  /** The receipt was flushed before this answer; older hosts never send it. */
  durableCommitted?: true
}

export function occdMigrationManifestHashInput(
  manifest: Omit<OCCdMigrationManifest, 'manifestSha256'>
): string {
  return serializeOCCdMigrationValue(manifest)
}

export function serializeOCCdMigrationValue(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value))
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue)
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalizeJsonValue(entry)])
  )
}
