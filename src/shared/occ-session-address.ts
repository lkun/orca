import { isAgentSessionId } from './agent-session/lifecycle/agent-session-record'
import { isTerminalHandle } from './terminal-handle-prefix'
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

export function isOCCSessionId(id: string): id is OCCSessionId {
  return isAgentSessionId(id) && !isTerminalHandle(id)
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
