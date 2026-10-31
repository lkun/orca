import { MAX_OCCD_MIGRATION_STAGED_CATALOGS } from '../../../shared/occd-migration/occd-migration-staged-catalog-validation'
import { OCCD_MIGRATION_MANIFEST_VERSION } from '../../../shared/occd-migration/occd-migration-manifest-validation'
import type {
  OCCdMigrationCatalogAbortResult,
  OCCdMigrationCatalogReference,
  OCCdMigrationCatalogReferenceAbortResult,
  OCCdMigrationCatalogState,
  OCCdMigrationImportReceipt,
  OCCdMigrationManifest
} from '../../../shared/occd-migration/occd-migration-manifest'
import type {
  OCCdMigrationSnapshotChunkRequest,
  OCCdMigrationSnapshotChunkResult
} from '../../../shared/occd-migration/occd-migration-scrollback'
import type {
  OCCdMigrationBlobChunkRequest,
  OCCdMigrationBlobChunkResult,
  OCCdMigrationBlobDescriptor
} from '../../../shared/occd-migration/occd-migration-blob-transfer'
import type { RepoLifecycleOperations } from '../loading-store/repo-lifecycle-operations'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import type { WriteSchedulingOperations } from '../loading-store/write-scheduling'
import { scheduleSave } from '../loading-store/write-scheduling'
import {
  applyPreparedOCCdMigrationCatalog,
  assertOCCdMigrationReceiptMatchesManifest,
  assertSameOCCdMigrationManifest,
  prepareOCCdMigrationCatalog,
  type PreparedOCCdMigrationCatalog
} from './occd-catalog-records'
import {
  expireOCCdMigrationStages,
  findOCCdMigrationImportReceipt,
  isLiveOCCdMigrationStage,
  recordOCCdMigrationCommitWriteGeneration,
  recordOCCdMigrationImportReceipt,
  type OCCdMigrationCommitGenerationRuntime
} from './occd-catalog-receipt-ledger'
import {
  abortOCCdMigrationSnapshots,
  assertOCCdMigrationSnapshotsReady,
  commitOCCdMigrationSnapshots,
  inspectOCCdMigrationSnapshotUploads,
  pruneOCCdMigrationSnapshotStaging,
  stageOCCdMigrationSnapshotChunk
} from './occd-scrollback-snapshot-transfer'
import {
  abortOCCdMigrationBlobs,
  assertOCCdMigrationBlobSetMatches,
  assertOCCdMigrationBlobsReady,
  commitOCCdMigrationBlobs,
  inspectOCCdMigrationBlobUploads,
  pruneOCCdMigrationBlobStaging,
  stageOCCdMigrationBlobChunk
} from './occd-migration-blob-staging'
import { assertOCCdMigrationBlobContentsValid } from './occd-migration-blob-installers'
import {
  abortOCCdMigrationCatalogByReference,
  committedMigrations,
  stagedManifests
} from './occd-catalog-reference-abort'

type OCCdCatalogImportRuntime = OCCdMigrationCommitGenerationRuntime &
  Pick<StoreRuntimeState, 'state' | 'terminalScrollbackSnapshotStorage' | 'occdMigrationBlobRoot'>

const occdCatalogImportContext = Symbol('OCCdCatalogImportPersistence')
type OCCdCatalogImportContext = {
  runtime: OCCdCatalogImportRuntime
  repos: RepoLifecycleOperations
  scheduling: WriteSchedulingOperations
}

// Manifests arrive parsed; the RPC boundary verified the digest over the bytes as sent.
export class OCCdCatalogImportPersistence {
  readonly [occdCatalogImportContext]: OCCdCatalogImportContext

  constructor(
    runtime: OCCdCatalogImportRuntime,
    repos: RepoLifecycleOperations,
    scheduling: WriteSchedulingOperations
  ) {
    this[occdCatalogImportContext] = { runtime, repos, scheduling }
  }

  stageOCCdMigrationCatalog(
    manifest: OCCdMigrationManifest,
    options: { now?: () => Date } = {}
  ): OCCdMigrationCatalogState {
    const context = this[occdCatalogImportContext]
    const now = options.now ?? (() => new Date())
    if (expireOCCdMigrationStages(context.runtime.state, now().getTime())) {
      scheduleSave(context.scheduling)
    }
    pruneOCCdMigrationSnapshotStaging(
      stagedManifests(context.runtime.state),
      context.runtime.terminalScrollbackSnapshotStorage
    )
    pruneOCCdMigrationBlobStaging(
      stagedManifests(context.runtime.state),
      committedMigrations(context.runtime.state),
      context.runtime.occdMigrationBlobRoot
    )
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    prepareOCCdMigrationCatalog(manifest, context.runtime.state)
    if (current.state === 'staged') {
      return current
    }
    const staged = context.runtime.state.occdMigrationStagedCatalogs ?? []
    if (staged.length >= MAX_OCCD_MIGRATION_STAGED_CATALOGS) {
      throw new Error('occd_migration_staging_capacity_exceeded')
    }
    const stagedAt = now().toISOString()
    context.runtime.state.occdMigrationStagedCatalogs = [
      ...staged,
      {
        version: OCCD_MIGRATION_MANIFEST_VERSION,
        manifest: structuredClone(manifest),
        stagedAt
      }
    ]
    scheduleSave(context.scheduling)
    return stagedCatalogState(manifest, stagedAt, context.runtime)
  }

  stageOCCdMigrationSnapshotChunk(
    request: OCCdMigrationSnapshotChunkRequest
  ): OCCdMigrationSnapshotChunkResult {
    const context = this[occdCatalogImportContext]
    return stageOCCdMigrationSnapshotChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      storage: context.runtime.terminalScrollbackSnapshotStorage,
      request
    })
  }

  stageOCCdMigrationBlobChunk(
    request: OCCdMigrationBlobChunkRequest
  ): OCCdMigrationBlobChunkResult {
    const context = this[occdCatalogImportContext]
    return stageOCCdMigrationBlobChunk({
      stagedManifest:
        stagedManifests(context.runtime.state).find(
          (manifest) => manifest.migrationId === request.migrationId
        ) ?? null,
      root: context.runtime.occdMigrationBlobRoot,
      request
    })
  }

  /** Omitted expectedBlobs preserves older senders' commit behavior. */
  commitStagedOCCdMigrationCatalog(
    manifest: OCCdMigrationManifest,
    options: { now?: () => Date; expectedBlobs?: readonly OCCdMigrationBlobDescriptor[] } = {}
  ): OCCdMigrationCatalogState {
    const context = this[occdCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed') {
      return current
    }
    if (current.state !== 'staged') {
      throw new Error('occd_migration_catalog_not_staged')
    }
    const prepared = prepareOCCdMigrationCatalog(manifest, context.runtime.state)
    const blobRoot = context.runtime.occdMigrationBlobRoot
    assertOCCdMigrationSnapshotsReady(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    if (options.expectedBlobs) {
      assertOCCdMigrationBlobSetMatches(manifest, blobRoot, options.expectedBlobs)
    }
    assertOCCdMigrationBlobsReady(manifest, blobRoot)
    assertOCCdMigrationBlobContentsValid(manifest, blobRoot)
    commitOCCdMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    commitOCCdMigrationBlobs(manifest, blobRoot)
    const receipt = commitPreparedCatalog(context, manifest, prepared, options.now)
    const generationBefore = context.runtime.writeGeneration
    scheduleSave(context.scheduling)
    recordOCCdMigrationCommitWriteGeneration(context.runtime, manifest, generationBefore)
    return committedCatalogState(receipt)
  }

  abortStagedOCCdMigrationCatalog(
    manifest: OCCdMigrationManifest
  ): OCCdMigrationCatalogAbortResult {
    const context = this[occdCatalogImportContext]
    const current = migrationCatalogState(context.runtime, manifest)
    if (current.state === 'committed' || current.state === 'absent') {
      return { ...current, aborted: false }
    }
    // Staged rows are dormant and unreferenced outside this stage.
    context.runtime.state.occdMigrationStagedCatalogs = (
      context.runtime.state.occdMigrationStagedCatalogs ?? []
    ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
    abortOCCdMigrationSnapshots(manifest, context.runtime.terminalScrollbackSnapshotStorage)
    abortOCCdMigrationBlobs(manifest, context.runtime.occdMigrationBlobRoot)
    scheduleSave(context.scheduling)
    return { ...absentCatalogState(manifest), aborted: true }
  }

  /** Use the stored manifest when the source cannot send one. */
  abortStagedOCCdMigrationCatalogByReference(
    reference: OCCdMigrationCatalogReference
  ): OCCdMigrationCatalogReferenceAbortResult {
    return abortOCCdMigrationCatalogByReference(
      this[occdCatalogImportContext].runtime.state,
      reference,
      (manifest) => this.abortStagedOCCdMigrationCatalog(manifest)
    )
  }

  getOCCdMigrationCatalogState(manifest: OCCdMigrationManifest): OCCdMigrationCatalogState {
    const context = this[occdCatalogImportContext]
    return migrationCatalogState(context.runtime, manifest)
  }

  hasStagedOCCdMigrationCatalog(now: number = Date.now()): boolean {
    return (this[occdCatalogImportContext].runtime.state.occdMigrationStagedCatalogs ?? []).some(
      (entry) => isLiveOCCdMigrationStage(entry.stagedAt, now)
    )
  }
}

function commitPreparedCatalog(
  context: OCCdCatalogImportContext,
  manifest: OCCdMigrationManifest,
  prepared: PreparedOCCdMigrationCatalog,
  now?: () => Date
): OCCdMigrationImportReceipt {
  applyPreparedOCCdMigrationCatalog(prepared, context.runtime.state, context.repos)
  const receipt: OCCdMigrationImportReceipt = {
    version: OCCD_MIGRATION_MANIFEST_VERSION,
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    source: structuredClone(manifest.source),
    importedAt: (now ?? (() => new Date()))().toISOString(),
    repositoryIds: prepared.repositories.map((repo) => repo.id),
    projectGroupIds: prepared.projectGroups.map((group) => group.id),
    folderWorkspaceIds: prepared.folderWorkspaces.map((workspace) => workspace.id)
  }
  context.runtime.state.occdMigrationStagedCatalogs = (
    context.runtime.state.occdMigrationStagedCatalogs ?? []
  ).filter((entry) => entry.manifest.migrationId !== manifest.migrationId)
  recordOCCdMigrationImportReceipt(context.runtime.state, receipt)
  return receipt
}

function migrationCatalogState(
  runtime: OCCdCatalogImportRuntime,
  manifest: OCCdMigrationManifest
): OCCdMigrationCatalogState {
  const { state } = runtime
  const receipt = findOCCdMigrationImportReceipt(state, manifest)
  if (receipt) {
    assertCommittedReceipt(receipt, manifest)
    return committedCatalogState(receipt)
  }
  const staged = state.occdMigrationStagedCatalogs?.find(
    (entry) => entry.manifest.migrationId === manifest.migrationId
  )
  if (!staged) {
    return absentCatalogState(manifest)
  }
  assertSameOCCdMigrationManifest(staged.manifest, manifest)
  return stagedCatalogState(manifest, staged.stagedAt, runtime)
}

// A committed receipt stays authoritative even after live rows and snapshots change.
function assertCommittedReceipt(
  receipt: OCCdMigrationImportReceipt,
  manifest: OCCdMigrationManifest
): void {
  if (receipt.manifestSha256 !== manifest.manifestSha256) {
    throw new Error('occd_migration_id_reused_with_different_manifest')
  }
  assertOCCdMigrationReceiptMatchesManifest(receipt, manifest)
}

function absentCatalogState(manifest: OCCdMigrationManifest): OCCdMigrationCatalogState {
  return {
    state: 'absent',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256
  }
}

function stagedCatalogState(
  manifest: OCCdMigrationManifest,
  stagedAt: string,
  runtime: OCCdCatalogImportRuntime
): OCCdMigrationCatalogState {
  const snapshotUploads = inspectOCCdMigrationSnapshotUploads(
    manifest,
    runtime.terminalScrollbackSnapshotStorage
  )
  // Omit absent uploads to preserve older hosts' response shape.
  const blobUploads = inspectOCCdMigrationBlobUploads(manifest, runtime.occdMigrationBlobRoot)
  return {
    state: 'staged',
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    stagedAt,
    ...(snapshotUploads ? { snapshotUploads } : {}),
    ...(blobUploads ? { blobUploads } : {})
  }
}

function committedCatalogState(receipt: OCCdMigrationImportReceipt): OCCdMigrationCatalogState {
  return {
    state: 'committed',
    migrationId: receipt.migrationId,
    manifestSha256: receipt.manifestSha256,
    receipt: structuredClone(receipt)
  }
}
