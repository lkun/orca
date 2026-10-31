// Export copies of relay-hosted SSH state without mutating source rows.
import {
  OCCD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
  type OCCdMigrationTerminalScrollbackSnapshot
} from '../../../shared/occd-migration/occd-migration-scrollback'
import type {
  OCCdMigrationCatalogPayload,
  OCCdMigrationDormantStatePayload,
  OCCdMigrationManifest,
  OCCdMigrationManifestSource
} from '../../../shared/occd-migration/occd-migration-manifest'
import { assertOCCdMigrationManifestDigest } from '../../occd/occd-migration-manifest-digest'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  collectOCCdMigrationUntransferredDependencyCensus,
  type OCCdMigrationSourceDependencyCensus
} from './occd-source-dependency-census'
import {
  collectOCCdMigrationSourceDormantState,
  type OCCdMigrationSourceDormantInspection
} from './occd-source-dormant-state'
import { readOCCdMigrationSourceScrollbackChunk } from './occd-source-scrollback-state'
import {
  createOCCdMigrationDeltaView,
  type OCCdMigrationDeltaView
} from './occd-source-delta-view'
import { syncOCCdMigrationScrollbackRetention } from './occd-source-scrollback-retention'
import { createOCCdMigrationLeaveBehindView } from './occd-source-leave-behind-view'
import {
  collectOCCdMigrationSourceDrafts,
  type OCCdMigrationSourceDrafts
} from './occd-source-draft-rename'

type OCCdSourceExportRuntime = Pick<
  StoreRuntimeState,
  'state' | 'terminalScrollbackSnapshotStorage' | 'retainedScrollbackRefsByMigrationId'
>

const occdSourceExportContext = Symbol('OCCdSourceExportPersistence')

export class OCCdSourceExportPersistence {
  readonly [occdSourceExportContext]: OCCdSourceExportRuntime

  constructor(runtime: OCCdSourceExportRuntime) {
    this[occdSourceExportContext] = runtime
  }

  collectOCCdMigrationSourceDormantState(
    source: OCCdMigrationManifestSource,
    catalog: OCCdMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ): OCCdMigrationDormantStatePayload {
    const runtime = this[occdSourceExportContext]
    return collectOCCdMigrationSourceDormantState(
      runtime.state,
      source,
      catalog,
      runtime.terminalScrollbackSnapshotStorage,
      destinationEnvironmentId
    ).payload
  }

  /** The export plus what it could not carry, for a move that must refuse rather than drop rows. */
  inspectOCCdMigrationSourceDormantState(
    source: OCCdMigrationManifestSource,
    catalog: OCCdMigrationCatalogPayload,
    destinationEnvironmentId?: string,
    daemonHistoryLeaf?: (tabId: string, leafId: string) => boolean
  ): OCCdMigrationSourceDormantInspection {
    const runtime = this[occdSourceExportContext]
    return collectOCCdMigrationSourceDormantState(
      runtime.state,
      source,
      catalog,
      runtime.terminalScrollbackSnapshotStorage,
      destinationEnvironmentId,
      daemonHistoryLeaf
    )
  }

  collectOCCdMigrationSourceDrafts(manifest: OCCdMigrationManifest): OCCdMigrationSourceDrafts {
    return collectOCCdMigrationSourceDrafts(this[occdSourceExportContext].state, manifest)
  }

  createOCCdMigrationDeltaView(moved: OCCdMigrationManifest): OCCdMigrationDeltaView {
    return createOCCdMigrationDeltaView(this[occdSourceExportContext], moved)
  }

  /** Preview "Move anyway" without recording consent. */
  createOCCdMigrationLeaveBehindView(targetId: string): OCCdMigrationDeltaView {
    return createOCCdMigrationLeaveBehindView(this[occdSourceExportContext], targetId)
  }

  inspectOCCdMigrationUntransferredDependencies(
    manifest: OCCdMigrationManifest
  ): OCCdMigrationSourceDependencyCensus {
    const runtime = this[occdSourceExportContext]
    return collectOCCdMigrationUntransferredDependencyCensus(
      runtime.state,
      manifest,
      runtime.terminalScrollbackSnapshotStorage
    )
  }

  /** Retain unfinished migrations' snapshots even if their tabs close. */
  syncOCCdMigrationScrollbackRetention(pending: readonly OCCdMigrationManifest[]): void {
    syncOCCdMigrationScrollbackRetention(this[occdSourceExportContext], pending)
  }

  /** Verify snapshot bytes against the signed manifest so changed buffers cannot be transferred. */
  readOCCdMigrationSourceSnapshotChunk(
    manifest: OCCdMigrationManifest,
    ref: string,
    offset: number
  ): { bytesBase64: string; totalBytes: number; eof: boolean } {
    assertOCCdMigrationManifestDigest(manifest)
    const descriptor: OCCdMigrationTerminalScrollbackSnapshot | undefined =
      manifest.payload.dormantState?.terminalScrollbackSnapshots?.find((entry) => entry.ref === ref)
    if (!descriptor) {
      throw new Error('occd_migration_source_snapshot_unknown')
    }
    const runtime = this[occdSourceExportContext]
    return readOCCdMigrationSourceScrollbackChunk({
      state: runtime.state,
      descriptor,
      retained: [...runtime.retainedScrollbackRefsByMigrationId.values()].some((refs) =>
        refs.has(ref)
      ),
      offset,
      length: OCCD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
      storage: runtime.terminalScrollbackSnapshotStorage
    })
  }
}
