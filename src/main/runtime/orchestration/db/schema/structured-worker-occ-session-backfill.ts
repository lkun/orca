import type Database from '../../../../sqlite/sync-database'
import { isOCCSessionId } from '../../../../../shared/occ-session-address'
import {
  STRUCTURED_WORKER_HANDLE_PREFIX,
  isStructuredWorkerHandle
} from '../../../../../shared/structured-worker-handle'
import {
  STRUCTURED_WORKER_INCARNATION_PREFIX,
  sessionIdFromStructuredWorkerIncarnation
} from '../../../structured-worker-identity'
import { currentRunCoordinatorOCCSessionIdSql } from '../runs/run-coordinator-occ-session'

const CURRENT_COORDINATOR_OCC_SESSION_ID_SQL = currentRunCoordinatorOCCSessionIdSql('runs')

// GLOB narrows by case-sensitive prefix; canonical identity predicates still decide.
const HANDLE_GLOB = `${STRUCTURED_WORKER_HANDLE_PREFIX}*`
const INCARNATION_GLOB = `${STRUCTURED_WORKER_INCARNATION_PREFIX}*`

const RECORDED_WORKER_SESSIONS_SQL = `
  SELECT assignee_handle AS handle, process_incarnation AS incarnation FROM dispatch_contexts
  WHERE assignee_handle GLOB ? AND process_incarnation GLOB ?
  UNION
  SELECT terminal_handle, process_incarnation FROM worker_terminal_resources
  WHERE terminal_handle GLOB ? AND process_incarnation GLOB ?`

/** Backfill only unambiguous local non-WSL structured incarnation evidence, never pane identity or a current recorded id.
 * Repeat on every open because rollback writers can omit these columns after the v42 stamp. */
export function backfillStructuredWorkerOCCSessionIds(db: Database.Database): void {
  let recordedSessions: Map<string, Set<string>> | undefined
  const occSessionIdFor = (handle: unknown, incarnation: unknown): string | null => {
    if (incarnation != null && typeof incarnation !== 'string') {
      return null
    }
    const sessions = new Set<string>()
    if (incarnation != null) {
      const sessionId = sessionIdFromStructuredWorkerIncarnation(incarnation)
      if (!sessionId) {
        // A live non-structured incarnation says this row is some other process.
        return null
      }
      sessions.add(sessionId)
    }
    if (typeof handle === 'string' && isStructuredWorkerHandle(handle)) {
      recordedSessions ??= recordedWorkerSessionsByHandle(db)
      for (const sessionId of recordedSessions.get(handle) ?? []) {
        sessions.add(sessionId)
      }
    }
    const [sessionId, ...others] = sessions
    return sessionId && others.length === 0 && isOCCSessionId(sessionId) ? sessionId : null
  }

  const assignees = db
    .prepare(
      `SELECT id, assignee_handle, process_incarnation FROM dispatch_contexts
       WHERE assignee_occ_session_id IS NULL
         AND (process_incarnation GLOB ? OR assignee_handle GLOB ?)`
    )
    .all(INCARNATION_GLOB, HANDLE_GLOB)
  const setAssignee = db.prepare(
    `UPDATE dispatch_contexts SET assignee_occ_session_id = ?
     WHERE id = ? AND assignee_occ_session_id IS NULL`
  )
  for (const row of assignees) {
    const occSessionId = occSessionIdFor(row.assignee_handle, row.process_incarnation)
    if (occSessionId && typeof row.id === 'string') {
      setAssignee.run(occSessionId, row.id)
    }
  }

  const creators = db
    .prepare(
      `SELECT id, creator_handle FROM dispatch_contexts
       WHERE creator_occ_session_id IS NULL AND creator_handle GLOB ?`
    )
    .all(HANDLE_GLOB)
  const setCreator = db.prepare(
    `UPDATE dispatch_contexts SET creator_occ_session_id = ?
     WHERE id = ? AND creator_occ_session_id IS NULL`
  )
  for (const row of creators) {
    const occSessionId = occSessionIdFor(row.creator_handle, null)
    if (occSessionId && typeof row.id === 'string') {
      setCreator.run(occSessionId, row.id)
    }
  }

  // An old-generation coordinator id is stale; backfill from the handle's proven session.
  const coordinators = db
    .prepare(
      `SELECT id, coordinator_handle FROM runs
       WHERE ${CURRENT_COORDINATOR_OCC_SESSION_ID_SQL} IS NULL AND coordinator_handle GLOB ?`
    )
    .all(HANDLE_GLOB)
  const setCoordinator = db.prepare(
    `UPDATE runs SET coordinator_occ_session_id = ?,
       coordinator_occ_session_id_generation = consumer_generation
     WHERE id = ? AND ${CURRENT_COORDINATOR_OCC_SESSION_ID_SQL} IS NULL`
  )
  for (const row of coordinators) {
    const occSessionId = occSessionIdFor(row.coordinator_handle, null)
    if (occSessionId && typeof row.id === 'string') {
      setCoordinator.run(occSessionId, row.id)
    }
  }
}

function recordedWorkerSessionsByHandle(db: Database.Database): Map<string, Set<string>> {
  const sessionsByHandle = new Map<string, Set<string>>()
  const rows = db
    .prepare(RECORDED_WORKER_SESSIONS_SQL)
    .all(HANDLE_GLOB, INCARNATION_GLOB, HANDLE_GLOB, INCARNATION_GLOB)
  for (const row of rows) {
    const sessionId =
      typeof row.incarnation === 'string'
        ? sessionIdFromStructuredWorkerIncarnation(row.incarnation)
        : null
    if (typeof row.handle !== 'string' || !sessionId) {
      continue
    }
    const sessions = sessionsByHandle.get(row.handle) ?? new Set<string>()
    sessions.add(sessionId)
    sessionsByHandle.set(row.handle, sessions)
  }
  return sessionsByHandle
}
