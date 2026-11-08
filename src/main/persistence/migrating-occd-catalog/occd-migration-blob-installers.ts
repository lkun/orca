// Validate blob contents before commit; install only advertised kinds after durable commit.
import { servesWslMovedPaneHistory } from '../../occd/occd-migration-wsl-destination'
import { readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { OCCdMigrationBlobKind } from '../../../shared/occd-migration/occd-migration-blob-transfer'
import type { OCCdMigrationManifest } from '../../../shared/occd-migration/occd-migration-manifest'
import {
  OCCD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  parseOCCdMigrationTerminalRestoreHintsText,
  type OCCdMigrationTerminalRestoreHint
} from '../../../shared/occd-migration/occd-migration-terminal-restore-hints'
import { syncDirectoryDurablySync } from '../../filesystem/durable-file-write'
import {
  getOCCdMigrationReceivedBlobPath,
  stagedOCCdMigrationBlobFiles
} from './occd-migration-blob-staging'
import {
  occdMigrationStagingKey,
  type OCCdMigrationRequestIdentity
} from './occd-migration-staged-file'
import {
  assertOCCdMigrationShellHistoryValid,
  installOCCdMigrationShellHistory
} from './occd-shell-history-installer'
import {
  assertOCCdMigrationTerminalHistoryValid,
  installOCCdMigrationTerminalHistory
} from './occd-terminal-history-installer'
import type {
  OCCdTerminalRestoreHintPlacement,
  OCCdTerminalRestoreHintStore
} from './occd-terminal-restore-hint-store'

type OCCdMigrationStagedBlobFile = {
  key: string
  path: string
  manifest: OCCdMigrationManifest
}

type OCCdMigrationBlobContentCheck = (file: OCCdMigrationStagedBlobFile) => void

const UTF8 = new TextDecoder('utf-8', { fatal: true })

const BLOB_CONTENT_CHECKS: Partial<Record<OCCdMigrationBlobKind, OCCdMigrationBlobContentCheck>> =
  {
    'terminal-restore-hints': ({ path }) => {
      parseOCCdMigrationTerminalRestoreHintsText(decodeUtf8(readFileSync(path)))
    },
    'shell-history': ({ key, path, manifest }) => {
      assertOCCdMigrationShellHistoryValid(key, path, manifest.payload)
    },
    'terminal-history': ({ key, path, manifest }) => {
      assertOCCdMigrationTerminalHistoryValid(key, path, manifest)
    }
  }

/** Reject malformed content before commit while the source still owns everything. */
export function assertOCCdMigrationBlobContentsValid(
  manifest: OCCdMigrationManifest,
  root: string
): void {
  for (const { descriptor, path } of stagedOCCdMigrationBlobFiles(manifest, root)) {
    const check = BLOB_CONTENT_CHECKS[descriptor.blobKind]
    if (!check) {
      continue
    }
    try {
      check({ key: descriptor.key, path, manifest })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`occd_migration_blob_content_invalid:${descriptor.blobKind}:${reason}`)
    }
  }
}

export type OCCdMigrationBlobInstall = {
  migration: OCCdMigrationRequestIdentity
  root: string
  terminalRestoreHints: OCCdTerminalRestoreHintStore
  /** This host's getHistoryRoot(). */
  shellHistoryRoot: string
  /** This host's `getDaemonHistoryDir()`, where its terminals' checkpoints live. */
  terminalHistoryRoot: string
  /** The shell binary a new pane on this host would actually run. */
  paneShellPath: () => string
  /** Defer without runtime evidence: shells surviving a restart could overwrite installed history. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
  deferredShellHistoryWorktreeIds: Set<string>
  paneWorktreeId: (paneKey: string) => string | null
  /** The workspace's folder on this host, or null when it is not here. */
  workspacePath: (worktreeId: string) => string | null
  now: number
}

/** Retain failed blobs for retry; installed-migration markers prevent consumed hints from reviving. */
export function installOCCdMigrationReceivedBlobs(install: OCCdMigrationBlobInstall): void {
  let firstError: unknown = null
  // Keep failures independent so other blob kinds can still install.
  for (const installKind of [
    installTerminalRestoreHints,
    installShellHistory,
    installTerminalHistory,
    removeImportedAutomationRunHistory
  ]) {
    try {
      installKind(install)
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== null) {
    throw firstError
  }
}

// The durable commit already holds these runs; the blob only served that commit.
function removeImportedAutomationRunHistory(install: OCCdMigrationBlobInstall): void {
  rmSync(
    getOCCdMigrationReceivedBlobPath(install.root, install.migration, {
      blobKind: 'automation-run-history',
      key: 'migration'
    }),
    { force: true }
  )
}

function installTerminalHistory(install: OCCdMigrationBlobInstall): void {
  // Only a WSL host advertises terminal history, so no other destination should hold any.
  if (!servesWslMovedPaneHistory()) {
    return
  }
  installOCCdMigrationTerminalHistory({
    migration: install.migration,
    root: install.root,
    historyRoot: install.terminalHistoryRoot,
    paneWorktreeId: install.paneWorktreeId,
    workspacePath: install.workspacePath,
    now: install.now
  })
}

function installShellHistory(install: OCCdMigrationBlobInstall): void {
  if (!install.worktreeHasLiveShells) {
    return
  }
  installOCCdMigrationShellHistory({
    migration: install.migration,
    root: install.root,
    historyRoot: install.shellHistoryRoot,
    paneShellPath: install.paneShellPath,
    worktreeHasLiveShells: install.worktreeHasLiveShells,
    deferredWorktreeIds: install.deferredShellHistoryWorktreeIds,
    now: install.now
  })
}

function installTerminalRestoreHints(install: OCCdMigrationBlobInstall): void {
  const path = getOCCdMigrationReceivedBlobPath(install.root, install.migration, {
    blobKind: 'terminal-restore-hints',
    key: OCCD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY
  })
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch {
    return
  }
  const migrationKey = occdMigrationStagingKey(install.migration)
  if (!install.terminalRestoreHints.hasInstalledMigration(migrationKey)) {
    try {
      const document = parseOCCdMigrationTerminalRestoreHintsText(decodeUtf8(bytes))
      install.terminalRestoreHints.install(
        { migrationKey, migrationId: install.migration.migrationId },
        placeHints(document.hints, install.paneWorktreeId),
        install.now
      )
    } catch (error) {
      if (!isHintFormatError(error)) {
        throw error
      }
      // Pre-commit validation passed; damaged hints can only fall back to the default folder now.
      console.error(
        `[occd-migration] dropped unreadable terminal restore hints for ${install.migration.migrationId}:`,
        error
      )
    }
  }
  rmSync(path, { force: true })
  syncDirectoryDurablySync(dirname(path))
}

// Drop hints whose panes have no worktree on this host.
function placeHints(
  hints: readonly OCCdMigrationTerminalRestoreHint[],
  paneWorktreeId: (paneKey: string) => string | null
): OCCdTerminalRestoreHintPlacement[] {
  return hints.flatMap((hint) => {
    const worktreeId = paneWorktreeId(hint.paneKey)
    return worktreeId ? [{ ...hint, worktreeId }] : []
  })
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return UTF8.decode(bytes)
  } catch {
    throw new Error('occd_migration_terminal_restore_hints_not_utf8')
  }
}

function isHintFormatError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('occd_migration_terminal_restore_')
}
