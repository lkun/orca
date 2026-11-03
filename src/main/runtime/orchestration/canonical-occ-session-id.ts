import { isOCCSessionId, type OCCSessionId } from '../../../shared/occ-session-address'
import {
  clearedInto,
  readAgentSessionRecordStore,
  type AgentSessionRecordReader
} from './structured-session-lineage'

/** Address by the /clear root to preserve Runs and mail; without records, retain the supplied id. */
export function canonicalOCCSessionId(
  occSessionId: OCCSessionId,
  store: Pick<
    AgentSessionRecordReader,
    'listRecords' | 'lineageRevision'
  > | null = readAgentSessionRecordStore()
): OCCSessionId {
  return createCanonicalOCCSessionResolver(store)(occSessionId)
}

/** Clear edges per lineage revision: mail checks ask per message, and must not rescan every record each time. */
const clearEdgesByRevision = new WeakMap<object, ReadonlyMap<string, string>>()

export function createCanonicalOCCSessionResolver(
  store: Pick<AgentSessionRecordReader, 'listRecords' | 'lineageRevision'> | null
): (id: OCCSessionId) => OCCSessionId {
  if (!store) {
    return (id) => id
  }
  const revision = store.lineageRevision?.()
  let clearedFrom = revision ? clearEdgesByRevision.get(revision) : undefined
  if (!clearedFrom) {
    const edges = new Map<string, string>()
    for (const record of store.listRecords()) {
      const next = clearedInto(record)
      if (next) {
        edges.set(next, record.sessionId)
      }
    }
    clearedFrom = edges
    if (revision) {
      clearEdgesByRevision.set(revision, edges)
    }
  }
  const edges = clearedFrom
  return (id) => canonicalOCCSessionFromEdges(id, edges)
}

export function canonicalOCCSessionFromEdges(
  occSessionId: OCCSessionId,
  clearedFrom: ReadonlyMap<string, string>
): OCCSessionId {
  // The visited set bounds corrupt chains; valid clear lineage is acyclic.
  let root: string = occSessionId
  const earlier = new Set([root])
  let prior = clearedFrom.get(root)
  while (prior && !earlier.has(prior)) {
    earlier.add(prior)
    root = prior
    prior = clearedFrom.get(root)
  }
  // Record ids are minted as OCC session ids; one that is not cannot name the conversation.
  return isOCCSessionId(root) ? root : occSessionId
}
