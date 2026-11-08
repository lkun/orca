import type {
  OCCdMigrationCatalogAbortResult,
  OCCdMigrationCatalogReference,
  OCCdMigrationCatalogReferenceAbortResult,
  OCCdMigrationCatalogState,
  OCCdMigrationManifest
} from '../../../../shared/occd-migration/occd-migration-manifest'
import type {
  OCCdMigrationSnapshotChunkRequest,
  OCCdMigrationSnapshotChunkResult
} from '../../../../shared/occd-migration/occd-migration-scrollback'
import type {
  OCCdMigrationBlobChunkRequest,
  OCCdMigrationBlobChunkResult,
  OCCdMigrationBlobDescriptor
} from '../../../../shared/occd-migration/occd-migration-blob-transfer'
import {
  abortStagedOCCdMigrationCatalogByReferenceDurably,
  abortStagedOCCdMigrationCatalogDurably,
  commitStagedOCCdMigrationCatalogDurably,
  getOCCdMigrationCatalogState,
  stageOCCdMigrationCatalogDurably
} from './occd-migration-catalog-import'
import { OCCRuntimeWithResolveExitWaiters } from '../../terminal/wait/terminal-wait-settlements'
import type { RuntimeStore } from '../../construction/runtime-store-contract'

type MigrationStoreKey =
  | 'stageOCCdMigrationCatalog'
  | 'commitStagedOCCdMigrationCatalog'
  | 'stageOCCdMigrationSnapshotChunk'
  | 'stageOCCdMigrationBlobChunk'
  | 'abortStagedOCCdMigrationCatalog'
  | 'abortStagedOCCdMigrationCatalogByReference'
  | 'getOCCdMigrationCatalogState'
  | 'flushPendingOrThrowAsync'

export abstract class OCCRuntimeWithMigrationCatalog extends OCCRuntimeWithResolveExitWaiters {
  async stageOCCdMigrationCatalog(
    manifest: OCCdMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<OCCdMigrationCatalogState> {
    return stageOCCdMigrationCatalogDurably({
      store: this.requireMigrationStore('stageOCCdMigrationCatalog', 'flushPendingOrThrowAsync'),
      manifest,
      signal: options.signal
    })
  }

  async commitStagedOCCdMigrationCatalog(
    manifest: OCCdMigrationManifest,
    options: {
      signal?: AbortSignal
      expectedBlobs?: readonly OCCdMigrationBlobDescriptor[]
    } = {}
  ): Promise<OCCdMigrationCatalogState> {
    return commitStagedOCCdMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'commitStagedOCCdMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal,
      expectedBlobs: options.expectedBlobs,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells,
      onDurableCommit: () => {
        this.invalidateResolvedWorktreeCache()
        this.notifyReposChanged()
      }
    })
  }

  stageOCCdMigrationSnapshotChunk(
    request: OCCdMigrationSnapshotChunkRequest
  ): OCCdMigrationSnapshotChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageOCCdMigrationSnapshotChunk')
      .stageOCCdMigrationSnapshotChunk!(request)
  }

  stageOCCdMigrationBlobChunk(
    request: OCCdMigrationBlobChunkRequest
  ): OCCdMigrationBlobChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageOCCdMigrationBlobChunk').stageOCCdMigrationBlobChunk!(
      request
    )
  }

  async abortStagedOCCdMigrationCatalog(
    manifest: OCCdMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<OCCdMigrationCatalogAbortResult> {
    return abortStagedOCCdMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'abortStagedOCCdMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal
    })
  }

  async abortStagedOCCdMigrationCatalogByReference(
    reference: OCCdMigrationCatalogReference,
    options: { signal?: AbortSignal } = {}
  ): Promise<OCCdMigrationCatalogReferenceAbortResult> {
    return abortStagedOCCdMigrationCatalogByReferenceDurably({
      store: this.requireMigrationStore(
        'abortStagedOCCdMigrationCatalogByReference',
        'flushPendingOrThrowAsync'
      ),
      reference,
      signal: options.signal
    })
  }

  getOCCdMigrationCatalogState(manifest: OCCdMigrationManifest): OCCdMigrationCatalogState {
    return getOCCdMigrationCatalogState({
      store: this.requireMigrationStore('getOCCdMigrationCatalogState'),
      manifest,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  /** Install deferred migrated history after host-shell discovery; unanswered inventory retries on the next catalog query. */
  async installPendingOCCdMigrationShellHistory(): Promise<void> {
    const store = this.store
    // Every daemon start calls this; no pending blobs must cost no inventory.
    if (
      !store?.installPendingOCCdMigrationReceivedBlobs ||
      !store.hasPendingOCCdMigrationShellHistory?.()
    ) {
      return
    }
    // Inventory first to find restart-surviving shells; real worktrees preserve their restored orchestration receipts.
    if (
      this.ptyController?.listProcesses &&
      !(await this.refreshPtyWorktreeRecordsWithControllerInventory([
        ...(await this.getResolvedWorktreeMap()).values()
      ]))
    ) {
      console.warn('[occd-migration] shell history waits: the terminal inventory did not answer')
      return
    }
    store.installPendingOCCdMigrationReceivedBlobs({
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  override onPtyExit(
    ...args: Parameters<OCCRuntimeWithResolveExitWaiters['onPtyExit']>
  ): ReturnType<OCCRuntimeWithResolveExitWaiters['onPtyExit']> {
    const worktreeId = this.ptysById.get(args[0])?.worktreeId
    const result = super.onPtyExit(...args)
    if (worktreeId) {
      try {
        this.store?.installDeferredOCCdMigrationShellHistory?.(worktreeId, {
          worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
        })
      } catch (error) {
        console.error('[occd-migration] installing deferred shell history failed:', error)
      }
    }
    return result
  }

  // Migrated history belongs here; same-id SSH twins never write it.
  private readonly migrationWorktreeHasLiveShells = (worktreeId: string): boolean =>
    this.getLivePtyIdsForWorktree(worktreeId, undefined, { resolvedConnectionId: null }).size > 0

  // Check the captured Store, not a potentially different virtual return.
  private requireMigrationStore(...methods: MigrationStoreKey[]): RuntimeStore {
    const store = this.store
    if (!store || methods.some((method) => typeof store[method] !== 'function')) {
      throw new Error('runtime_unavailable')
    }
    return this.requireStore()
  }
}
