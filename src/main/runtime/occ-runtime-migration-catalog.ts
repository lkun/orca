import type {
  OCCdMigrationCatalogAbortResult,
  OCCdMigrationCatalogReference,
  OCCdMigrationCatalogReferenceAbortResult,
  OCCdMigrationCatalogState,
  OCCdMigrationManifest
} from '../../shared/occd-migration/occd-migration-manifest'
import type {
  OCCdMigrationSnapshotChunkRequest,
  OCCdMigrationSnapshotChunkResult
} from '../../shared/occd-migration/occd-migration-scrollback'
import type {
  OCCdMigrationBlobChunkRequest,
  OCCdMigrationBlobChunkResult,
  OCCdMigrationBlobDescriptor
} from '../../shared/occd-migration/occd-migration-blob-transfer'
import {
  abortStagedOCCdMigrationCatalogByReferenceDurably,
  abortStagedOCCdMigrationCatalogDurably,
  commitStagedOCCdMigrationCatalogDurably,
  getOCCdMigrationCatalogState,
  stageOCCdMigrationCatalogDurably
} from './occd-migration-catalog-import'
import { OCCRuntimeWithResolveWaiter } from './occ-runtime-resolve-waiter'
import type { WslMoveLiveTerminal } from '../persistence/moving-wsl-projects/wsl-move-gate-facts'
import type { RuntimeStore } from './runtime-store-contract'
import type { SessionReadTerminalScrollbackResult } from '../../shared/rpc-contract/session-terminal-scrollback-params'
import {
  readHostTerminalScrollback,
  type HostTerminalScrollbackReadRequest
} from './host-terminal-scrollback-read'

type MigrationStoreKey =
  | 'stageOCCdMigrationCatalog'
  | 'commitStagedOCCdMigrationCatalog'
  | 'stageOCCdMigrationSnapshotChunk'
  | 'stageOCCdMigrationBlobChunk'
  | 'abortStagedOCCdMigrationCatalog'
  | 'abortStagedOCCdMigrationCatalogByReference'
  | 'getOCCdMigrationCatalogState'
  | 'flushPendingOrThrowAsync'

/** The destination half of a dormant catalog migration; every mutation is flushed before it answers. */
export abstract class OCCRuntimeWithMigrationCatalog extends OCCRuntimeWithResolveWaiter {
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
    ...args: Parameters<OCCRuntimeWithResolveWaiter['onPtyExit']>
  ): ReturnType<OCCRuntimeWithResolveWaiter['onPtyExit']> {
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

  /** A migrated pane's stored scrollback, for a client whose own copy is gone or never existed. */
  async readTerminalScrollbackForClient(
    request: HostTerminalScrollbackReadRequest
  ): Promise<SessionReadTerminalScrollbackResult> {
    const store = this.store
    const readSnapshot = store?.readTerminalScrollbackSnapshotAsync
    const statSnapshotSize = store?.statTerminalScrollbackSnapshotSize
    if (!store || !readSnapshot || !statSnapshotSize) {
      throw new Error('runtime_unavailable')
    }
    return readHostTerminalScrollback(
      {
        resolveWorktreeId: async (selector) => (await this.resolveWorkspaceSelector(selector)).id,
        getWorkspaceSession: (worktreeId) => this.workspaceSessions.get(worktreeId),
        statSnapshotSize: (ref) => statSnapshotSize.call(store, ref),
        readSnapshot: (ref) => readSnapshot.call(store, ref)
      },
      request
    )
  }

  /** The pane a live terminal shows, including one the window has not reopened since a relaunch. */
  wslMovePaneKeyForPty(ptyId: string): string | null {
    const pty = this.ptysById.get(ptyId)
    return pty ? this.paneOfPty(pty).paneKey : null
  }

  /** This desktop's live terminals in the workspaces, for a WSL move's gate and pause. */
  listWslMoveLiveTerminals(workspaceIds: readonly string[]): WslMoveLiveTerminal[] {
    const terminals = new Map<string, WslMoveLiveTerminal>()
    for (const workspaceId of workspaceIds) {
      // Local only: a same-id SSH twin's terminals are another host's.
      for (const ptyId of this.getLivePtyIdsForWorktree(workspaceId, undefined, {
        resolvedConnectionId: null
      })) {
        const pty = this.ptysById.get(ptyId)
        terminals.set(ptyId, {
          ptyId,
          workspaceId,
          paneKey: pty ? this.paneOfPty(pty).paneKey : null,
          wslDistro: pty?.wslDistro ?? null,
          foregroundAgent: pty?.foregroundAgent ?? null
        })
      }
    }
    return [...terminals.values()]
  }

  // Check the captured Store, not a potentially different virtual return.
  private requireMigrationStore(...methods: MigrationStoreKey[]): RuntimeStore {
    const store = this.store
    if (!store || methods.some((method) => typeof store[method] !== 'function')) {
      throw new Error('runtime_unavailable')
    }
    return this.requireStore()
  }
}
