/** Resolve structured-owned mail to a session turn, covering Run, session, Dispatch and worker-handle addresses. */

import {
  OCC_SESSION_ADDRESS_PREFIX,
  isOCCSessionId,
  parseOCCSessionAddress,
  type OCCSessionId
} from '../../../shared/occ-session-address'
import type { OrchestrationDb } from './db'
import { currentRunCoordinatorOCCSessionId } from './db/runs/run-coordinator-occ-session'
import type { StructuredPointerTarget } from './structured-mailbox-pointer-delivery'
import {
  addressableSessionParty,
  structuredSessionMailReach
} from './structured-session-mail-address'
import {
  readAgentSessionRecordStore,
  type AgentSessionRecordReader
} from './structured-session-lineage'
import type { DispatchContextRow, RunRow } from './types'
import { chatAssigneeSessionId } from './chat-assignee'

/** A handle-less coordinator uses its generation-current session id; structured workers resolve by handle. */
export function handleLessCoordinatorSessionId(
  run: Pick<
    RunRow,
    | 'coordinator_handle'
    | 'coordinator_occ_session_id'
    | 'coordinator_occ_session_id_generation'
    | 'consumer_generation'
  >
): OCCSessionId | null {
  if (run.coordinator_handle !== null) {
    return null
  }
  return currentRunCoordinatorOCCSessionId(run)
}

/** Resolve any lineage session to its live reachable target; null means unreachable here. */
export function structuredSessionMailTarget(
  sessionId: string,
  db: OrchestrationDb | null | undefined,
  store: AgentSessionRecordReader | null = readAgentSessionRecordStore()
): StructuredPointerTarget | null {
  const record = store?.getRecord(sessionId)
  const reach = store && record ? structuredSessionMailReach(store, record, db) : null
  return reach?.kind === 'reachable'
    ? { sessionId: reach.session.sessionId, dispatchId: null }
    : null
}

/** Chat Dispatch target under its budget; undefined preserves non-chat worker lookup. */
export function chatDispatchMailTarget(
  dispatch: Pick<DispatchContextRow, 'id' | 'assignee_handle'>,
  db: OrchestrationDb | null | undefined
): StructuredPointerTarget | null | undefined {
  const sessionId = chatAssigneeSessionId(dispatch.assignee_handle)
  if (!sessionId) {
    return undefined
  }
  const target = structuredSessionMailTarget(sessionId, db)
  return target ? { ...target, dispatchId: dispatch.id } : null
}

/** Resolve session addresses; undefined lets other address forms use their own resolver. */
export function structuredSessionAddressTarget(
  mailboxHandle: string,
  db: OrchestrationDb | null | undefined
): StructuredPointerTarget | null | undefined {
  if (!mailboxHandle.startsWith(OCC_SESSION_ADDRESS_PREFIX)) {
    return undefined
  }
  const sessionId = parseOCCSessionAddress(mailboxHandle)
  return sessionId ? structuredSessionMailTarget(sessionId, db) : null
}

/** Re-derive Run, direct and active-Dispatch mail on each idle edge, including root mail for /clear successors. */
export function structuredSessionOwnedMailboxes(sessionId: string, db: OrchestrationDb): string[] {
  const party = isOCCSessionId(sessionId) ? addressableSessionParty(sessionId, db) : null
  if (!party) {
    return []
  }
  const mailboxes = db.runsBoundToCoordinator(party).map((run) => `run:${run.id}`)
  if (db.getUnreadDirectMessageTypes(party.address).length > 0) {
    mailboxes.push(party.address)
  }
  // Re-derive Dispatch mail through current party identity; a cleared or restarted session has no future idle edge.
  const dispatch = db.findActiveDispatchForAssignee(party.address, party.paneKey ?? undefined)
  if (dispatch) {
    mailboxes.push(`dispatch:${dispatch.id}`)
  }
  return mailboxes
}

/** Open an existing DB to redrive restart mail; no file means no mail and creates no DB. */
export function structuredSessionIdleEdgeMailboxes(
  sessionId: string,
  openDb: () => OrchestrationDb | null
): string[] {
  let db: OrchestrationDb | null
  try {
    db = openDb()
  } catch (error) {
    console.warn('[orchestration] skipped a structured session mail edge: no database', {
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
  return db ? structuredSessionOwnedMailboxes(sessionId, db) : []
}
