import { OCCD_MIGRATION_BLOB_KIND_CONTRACTS } from '../../../shared/occd-migration/occd-migration-blob-transfer'
import type { OCCdMigrationManifest } from '../../../shared/occd-migration/occd-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import { getDaemonHistoryDir } from '../../daemon/daemon-launch-paths'
import { getHistoryRoot } from '../../terminal-history-paths'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  findOCCdMigrationImportReceipt,
  isOCCdMigrationCommitDurable
} from './occd-catalog-receipt-ledger'
import { installOCCdMigrationReceivedBlobs } from './occd-migration-blob-installers'
import { listOCCdMigrationReceivedBlobNames } from './occd-migration-blob-staging'
import type { OCCdMigrationRequestIdentity } from './occd-migration-staged-file'

type OCCdMigrationBlobInstallRuntime = Pick<
  StoreRuntimeState,
  | 'state'
  | 'occdMigrationBlobRoot'
  | 'occdTerminalRestoreHints'
  | 'paneShellPath'
  | 'deferredShellHistoryWorktreeIds'
  | 'writeGeneration'
  | 'lastDurableWriteGeneration'
  | 'occdMigrationCommitWriteGenerations'
>

type ClockOptions = { now?: () => Date }
type InstallOptions = ClockOptions & {
  /** Defer history installation while shells run in its worktree. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
}

const occdMigrationBlobInstallContext = Symbol('OCCdMigrationBlobInstallPersistence')
type OCCdMigrationBlobInstallContext = {
  runtime: OCCdMigrationBlobInstallRuntime
}

export class OCCdMigrationBlobInstallPersistence {
  readonly [occdMigrationBlobInstallContext]: OCCdMigrationBlobInstallContext

  constructor(runtime: OCCdMigrationBlobInstallRuntime) {
    this[occdMigrationBlobInstallContext] = { runtime }
  }

  /** Wait for durable commit or a restart could lose both the catalog and its consumed blobs. */
  installOCCdMigrationReceivedBlobs(
    manifest: OCCdMigrationManifest,
    options: InstallOptions = {}
  ): void {
    const receipt = findOCCdMigrationImportReceipt(
      this[occdMigrationBlobInstallContext].runtime.state,
      manifest
    )
    if (receipt?.manifestSha256 !== manifest.manifestSha256) {
      return
    }
    installCommitted(this[occdMigrationBlobInstallContext].runtime, manifest, options)
  }

  /** Recover interrupted installs; disk-loaded receipts already prove durability. */
  installPendingOCCdMigrationReceivedBlobs(options: InstallOptions = {}): void {
    const { runtime } = this[occdMigrationBlobInstallContext]
    for (const receipt of [
      ...(runtime.state.occdMigrationImportReceipts ?? []),
      ...(runtime.state.occdMigrationEvictedReceipts ?? [])
    ]) {
      try {
        installCommitted(runtime, receipt, options)
      } catch (error) {
        console.error(
          `[occd-migration] installing received blobs for ${receipt.migrationId} failed:`,
          error
        )
      }
    }
  }

  /** Only the runtime installs pending shell history. */
  hasPendingOCCdMigrationShellHistory(): boolean {
    const { runtime } = this[occdMigrationBlobInstallContext]
    return [
      ...(runtime.state.occdMigrationImportReceipts ?? []),
      ...(runtime.state.occdMigrationEvictedReceipts ?? [])
    ].some((receipt) =>
      listOCCdMigrationReceivedBlobNames(
        runtime.occdMigrationBlobRoot,
        receipt,
        'shell-history'
      ).some((key) => OCCD_MIGRATION_BLOB_KIND_CONTRACTS['shell-history'].key.test(key))
    )
  }

  installDeferredOCCdMigrationShellHistory(
    worktreeId: string,
    options: InstallOptions = {}
  ): void {
    const { runtime } = this[occdMigrationBlobInstallContext]
    if (runtime.deferredShellHistoryWorktreeIds.has(worktreeId)) {
      this.installPendingOCCdMigrationReceivedBlobs(options)
    }
  }

  /** Read without consuming. */
  peekOCCdMigrationTerminalRestoreHint(
    paneKey: string,
    worktreeId: string,
    options: ClockOptions = {}
  ): string | null {
    return this[occdMigrationBlobInstallContext].runtime.occdTerminalRestoreHints.peek(
      paneKey,
      worktreeId,
      clock(options)
    )
  }

  /** Consume after spawn, even if it used a different cwd. */
  consumeOCCdMigrationTerminalRestoreHint(paneKey: string, options: ClockOptions = {}): void {
    this[occdMigrationBlobInstallContext].runtime.occdTerminalRestoreHints.consume(
      paneKey,
      clock(options)
    )
  }
}

function installCommitted(
  runtime: OCCdMigrationBlobInstallRuntime,
  migration: OCCdMigrationRequestIdentity,
  options: InstallOptions
): void {
  if (!isOCCdMigrationCommitDurable(runtime, migration)) {
    return
  }
  installOCCdMigrationReceivedBlobs({
    migration,
    root: runtime.occdMigrationBlobRoot,
    terminalRestoreHints: runtime.occdTerminalRestoreHints,
    shellHistoryRoot: getHistoryRoot(),
    terminalHistoryRoot: getDaemonHistoryDir(),
    paneShellPath: () => runtime.paneShellPath(runtime.state.settings?.terminalDefaultShell),
    worktreeHasLiveShells: options.worktreeHasLiveShells,
    deferredShellHistoryWorktreeIds: runtime.deferredShellHistoryWorktreeIds,
    paneWorktreeId: (paneKey) => findPaneWorktreeId(runtime.state, paneKey),
    workspacePath: (worktreeId) => findWorkspacePath(runtime.state, worktreeId),
    now: clock(options)
  })
}

function clock(options: ClockOptions): number {
  return (options.now ?? (() => new Date()))().getTime()
}

// A git worktree id carries its path; a folder workspace's is on its record.
function findWorkspacePath(state: PersistedState, worktreeId: string): string | null {
  const separator = worktreeId.indexOf('::')
  if (separator > 0) {
    return worktreeId.slice(separator + 2) || null
  }
  return state.folderWorkspaces.find((folder) => folder.id === worktreeId)?.folderPath ?? null
}

// The commit merged the moved session in with its worktree ids unchanged.
function findPaneWorktreeId(state: PersistedState, paneKey: string): string | null {
  const tabId = parsePaneKey(paneKey)?.tabId
  if (!tabId) {
    return null
  }
  const sessions = [state.workspaceSession, ...Object.values(state.workspaceSessionsByHostId ?? {})]
  for (const session of sessions) {
    for (const [worktreeId, tabs] of Object.entries(session?.tabsByWorktree ?? {})) {
      if (tabs.some((tab) => tab.id === tabId)) {
        return worktreeId
      }
    }
  }
  return null
}
