import type { OCCdMigrationManifest } from '../../../shared/occd-migration/occd-migration-manifest'
import {
  OCCD_MIGRATION_DEPENDENCY_KINDS,
  type OCCdMigrationDependencyKind
} from '../../../shared/occd-migration/occd-migration-preflight'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { TerminalScrollbackSnapshotStorage } from '../../pty/scrollback/terminal-scrollback-snapshots'
import {
  inspectOCCdMigrationSourceSessions,
  type OCCdMigrationSourceSessionInspection
} from './occd-source-session-dependencies'
import {
  collectOCCdMigrationSourceDormantState,
  occdMigrationLeavesBehind
} from './occd-source-dormant-state'
import {
  createOCCdMigrationSourceScope,
  occdMigrationOwnerMatchesScope,
  occdMigrationPartitionScope,
  type OCCdMigrationSourceScope
} from './occd-source-scope'
import { paneBelongsToTabs } from '../../../shared/workspace-session/workspace-session-pane-ownership'

export type OCCdMigrationSourceDependencyCensus = {
  totalCount: number
  counts: Record<OCCdMigrationDependencyKind, number>
  /** Blocker names and remedies where available. */
  names?: Partial<Record<OCCdMigrationDependencyKind, string[]>>
}

export function collectOCCdMigrationUntransferredDependencyCensus(
  state: PersistedState,
  manifest: OCCdMigrationManifest,
  storage?: TerminalScrollbackSnapshotStorage
): OCCdMigrationSourceDependencyCensus {
  const scope = createOCCdMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  const sessions = inspectOCCdMigrationSourceSessions(state, {
    hostId: scope.hostId,
    ownerMatches: (ownerKey, partitionHostId) =>
      occdMigrationOwnerMatchesScope(
        ownerKey,
        occdMigrationPartitionScope(scope, partitionHostId)
      )
  })
  const dormant = collectOCCdMigrationSourceDormantState(
    state,
    manifest.source,
    manifest.payload,
    storage,
    manifest.destinationEnvironmentId
  )
  const counts: Record<OCCdMigrationDependencyKind, number> = {
    ...dormant.blockedCounts,
    'terminal-lease': state.sshRemotePtyLeases.filter(
      (lease) => lease.targetId === scope.targetId && lease.state !== 'terminated'
    ).length,
    // Retained recoveries can stay behind; the terminal gate still requires exit.
    'terminal-recovery': occdMigrationLeavesBehind(state, scope.targetId)
      ? 0
      : countTerminalRecoveryState(state, scope, sessions)
  }
  return {
    counts,
    totalCount: OCCD_MIGRATION_DEPENDENCY_KINDS.reduce((total, kind) => total + counts[kind], 0),
    names: {
      ...(dormant.blockedSessionItems.length > 0
        ? { 'workspace-session': dormant.blockedSessionItems }
        : {}),
      ...(dormant.runningAutomationItems.length > 0
        ? { 'automation-run': dormant.runningAutomationItems }
        : {})
    }
  }
}

// The terminal gate proves recovery leases exited; hook aliases add no independent terminal ownership.
function countTerminalRecoveryState(
  state: PersistedState,
  scope: OCCdMigrationSourceScope,
  sessions: OCCdMigrationSourceSessionInspection
): number {
  return state.migrationUnsupportedPtyEntries.filter(
    (entry) =>
      occdMigrationOwnerMatchesScope(entry.worktreeId, scope) ||
      (entry.tabId ? sessions.tabIds.has(entry.tabId) : false) ||
      sessions.ptyIds.has(entry.ptyId) ||
      (entry.paneKey ? paneBelongsToTabs(entry.paneKey, sessions.tabIds) : false)
  ).length
}
