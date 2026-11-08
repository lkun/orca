import {
  parseOCCSessionAddress,
  type OCCSessionId
} from '../../../../../shared/occ-session-address'
import { structuredWorkerOCCSessionIdForIncarnation } from '../../terminal-authority/structured-sessions/structured-worker-identity'
import { canonicalOCCSessionId } from './canonical-occ-session-id'

/** Resolve structured incarnations or chat addresses to bare session ids; PTYs have none. */
export function dispatchAssigneeOCCSessionId(assignee: {
  handle: string
  processIncarnation: string | null | undefined
}): OCCSessionId | null {
  const occSessionId =
    structuredWorkerOCCSessionIdForIncarnation(assignee.processIncarnation) ??
    parseOCCSessionAddress(assignee.handle)
  return occSessionId === null ? null : canonicalOCCSessionId(occSessionId)
}
