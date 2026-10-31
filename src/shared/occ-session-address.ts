import { isAgentSessionId } from './agent-session-record'
import { STRUCTURED_WORKER_HANDLE_PREFIX } from './structured-worker-handle'
import { OCC_SESSION_ADDRESS_PREFIX } from './occ-session-address-prefix'

/** OCC-minted structured session identity (record id/OCC_AGENT_SESSION_ID), never provider identity. Orchestration stores bare lineage-root ids after /clear,
 * not live replacement ids; derive mail spelling occ_session_id:<id> alongside run:/dispatch: addresses.
 * Resolve execution location from records. PTYs have no id today; never use pane keys because later agents inherit panes. */
export { OCC_SESSION_ADDRESS_PREFIX }

declare const occSessionIdBrand: unique symbol
declare const occSessionAddressBrand: unique symbol

/** A bare OCC session id; only `isOCCSessionId` and `parseOCCSessionAddress` produce one. */
export type OCCSessionId = string & { readonly [occSessionIdBrand]: true }
/** An `occ_session_id:<id>` mail address; only `formatOCCSessionAddress` produces one. */
export type OCCSessionAddress = string & { readonly [occSessionAddressBrand]: true }

// Terminal handles (term_/structworker_) share the charset but are never durable session ids.
const TERMINAL_HANDLE_PREFIXES = ['term_', STRUCTURED_WORKER_HANDLE_PREFIX] as const

export function isOCCSessionId(id: string): id is OCCSessionId {
  return isAgentSessionId(id) && !TERMINAL_HANDLE_PREFIXES.some((prefix) => id.startsWith(prefix))
}

export function formatOCCSessionAddress(occSessionId: OCCSessionId): OCCSessionAddress {
  const address = `${OCC_SESSION_ADDRESS_PREFIX}${occSessionId}`
  // Always true for a checked id; the check brands the address without a type assertion.
  if (!isOCCSessionAddress(address)) {
    throw new Error(`Not an OCC session id: ${occSessionId}`)
  }
  return address
}

/** The bare OCC session id of an `occ_session_id:<id>` address; anything else reads as null. */
export function parseOCCSessionAddress(address: string | null | undefined): OCCSessionId | null {
  if (!address?.startsWith(OCC_SESSION_ADDRESS_PREFIX)) {
    return null
  }
  const id = address.slice(OCC_SESSION_ADDRESS_PREFIX.length)
  return isOCCSessionId(id) ? id : null
}

function isOCCSessionAddress(address: string): address is OCCSessionAddress {
  return parseOCCSessionAddress(address) !== null
}
