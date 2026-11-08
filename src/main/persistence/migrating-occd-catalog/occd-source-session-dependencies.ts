import type { ExecutionHostId } from '../../../shared/execution-host'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session/workspace-session-state-types'
import { sessionPartitions } from './occd-source-workspace-session-fragments'

export type OCCdMigrationSourceSessionInspection = {
  ptyIds: Set<string>
  tabIds: Set<string>
}

type SessionScope = {
  hostId: ExecutionHostId
  /** `partitionHostId` owns the partition's unqualified keys. */
  ownerMatches: (ownerKey: string, partitionHostId: string) => boolean
}

export function inspectOCCdMigrationSourceSessions(
  state: PersistedState,
  scope: SessionScope
): OCCdMigrationSourceSessionInspection {
  const result: OCCdMigrationSourceSessionInspection = {
    ptyIds: new Set(),
    tabIds: new Set()
  }
  for (const [hostId, session] of sessionPartitions(state, 'local')) {
    inspectSession(session, scope, hostId, result)
  }
  return result
}

function inspectSession(
  session: WorkspaceSessionState,
  scope: SessionScope,
  partitionHostId: string,
  result: OCCdMigrationSourceSessionInspection
): void {
  const sourceHostPartition = partitionHostId === scope.hostId
  const matchesOwner = (ownerKey: string): boolean =>
    Boolean(ownerKey) && (sourceHostPartition || scope.ownerMatches(ownerKey, partitionHostId))
  for (const [ownerKey, tabs] of Object.entries(session.tabsByWorktree ?? {})) {
    if (!matchesOwner(ownerKey)) {
      continue
    }
    for (const tab of tabs) {
      result.tabIds.add(tab.id)
      if (tab.ptyId) {
        result.ptyIds.add(tab.ptyId)
      }
    }
  }
  for (const [ownerKey, tabs] of Object.entries(session.unifiedTabs ?? {})) {
    if (!matchesOwner(ownerKey)) {
      continue
    }
    for (const tab of tabs) {
      if (tab.contentType === 'terminal') {
        result.tabIds.add(tab.entityId)
      }
    }
  }
  for (const tombstone of Object.values(session.terminalSurfaceTombstonesByPaneKey ?? {})) {
    if (matchesOwner(tombstone.worktreeId)) {
      result.ptyIds.add(tombstone.ptyId)
    }
  }
}
