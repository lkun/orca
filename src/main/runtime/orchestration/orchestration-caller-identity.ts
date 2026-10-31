import type { RunRow } from './types'
import { isEquivalentPaneKey } from './db/pane-key-match'
import { currentRunCoordinatorOCCSessionId } from './db/runs/run-coordinator-occ-session'
import { formatOCCSessionAddress, type OCCSessionId } from '../../../shared/occ-session-address'
import type { OrchestrationPartyIdentity } from '../../../shared/orchestration-party-identity'

/** Who an orchestration caller is; shared so a queued message can name its sender the same way. */
export type OrchestrationCallerIdentity = OrchestrationPartyIdentity

/** The part of a caller a Run binding stores and matches. */
export type OrchestrationCoordinatorKey = Pick<
  OrchestrationCallerIdentity,
  'terminalHandle' | 'paneKey' | 'occSessionId'
>

/** A caller the dispatch entry resolved from the OCC session id in its injected environment. */
export type OrchestrationSessionCaller = OrchestrationCallerIdentity &
  Readonly<{
    occSessionId: OCCSessionId
    /** The session record the request came from. */
    sessionId: OCCSessionId
    /** Where the session runs, from its record; `worker-start --worktree current` places here. */
    workspaceId: string
  }>

/** A caller with neither a pane nor an OCC session id can never be bound to a Run. */
export function hasRunBindingKey(caller: OrchestrationCoordinatorKey): boolean {
  return caller.paneKey !== null || caller.occSessionId !== null
}

/** The one address a party reads mail at and is sent mail at; null for a key naming nobody. */
export function mailboxAddressOf(
  party: Pick<OrchestrationCoordinatorKey, 'terminalHandle' | 'occSessionId'>
): string | null {
  // Workers read mail at their handles, so prefer that address when both identities exist.
  if (party.terminalHandle !== null) {
    return party.terminalHandle
  }
  return party.occSessionId === null ? null : formatOCCSessionAddress(party.occSessionId)
}

/** Who a Run's binding names now; an OCC session id an older binding left behind is not part of it. */
export function runCoordinatorKey(run: RunRow): OrchestrationCoordinatorKey {
  return {
    terminalHandle: run.coordinator_handle,
    paneKey: run.coordinator_pane_key,
    occSessionId: currentRunCoordinatorOCCSessionId(run)
  }
}

export function runBoundToCoordinator(run: RunRow, caller: OrchestrationCoordinatorKey): boolean {
  if (
    caller.paneKey !== null &&
    run.coordinator_pane_key !== null &&
    isEquivalentPaneKey(run.coordinator_pane_key, caller.paneKey)
  ) {
    return true
  }
  return (
    caller.occSessionId !== null &&
    currentRunCoordinatorOCCSessionId(run) === caller.occSessionId
  )
}
