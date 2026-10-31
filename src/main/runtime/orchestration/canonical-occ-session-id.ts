import { isOCCSessionId, type OCCSessionId } from '../../../shared/occ-session-address'
import {
  clearedInto,
  readAgentSessionRecordStore,
  type AgentSessionRecordReader
} from './structured-session-lineage'

/** Address by the /clear root to preserve Runs and mail; without records, retain the supplied id. */
export function canonicalOCCSessionId(
  occSessionId: OCCSessionId,
  store: Pick<AgentSessionRecordReader, 'listRecords'> | null = readAgentSessionRecordStore()
): OCCSessionId {
  if (!store) {
    return occSessionId
  }
  const clearedFrom = new Map<string, string>()
  for (const record of store.listRecords()) {
    const next = clearedInto(record)
    if (next) {
      clearedFrom.set(next, record.sessionId)
    }
  }
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
