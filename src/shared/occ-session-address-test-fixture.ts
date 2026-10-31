import { isOCCSessionId, type OCCSessionId } from './occ-session-address'

/** A literal OCC session id for a test, checked by the same predicate production uses. */
export function testOCCSessionId(id: string): OCCSessionId {
  if (!isOCCSessionId(id)) {
    throw new Error(`Not an OCC session id: ${id}`)
  }
  return id
}
