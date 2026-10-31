import { describe, expect, it } from 'vitest'
import {
  formatOCCSessionAddress,
  isOCCSessionId,
  parseOCCSessionAddress
} from './occ-session-address'
import { testOCCSessionId } from './occ-session-address-test-fixture'

const SESSION_ID = testOCCSessionId('0b7e4c2a-5f1d-4e8a-9c3b-2d6f8a1e4b70')
const ADDRESS = `occ_session_id:${SESSION_ID}`

describe('OCC session address', () => {
  it('addresses an OCC session id as occ_session_id:<id> and parses the bare id back', () => {
    expect(formatOCCSessionAddress(SESSION_ID)).toBe(ADDRESS)
    expect(parseOCCSessionAddress(ADDRESS)).toBe(SESSION_ID)
    const parsed = parseOCCSessionAddress(ADDRESS)
    expect(parsed && formatOCCSessionAddress(parsed)).toBe(ADDRESS)
  })

  it('reads only the addressed spelling when parsing an address', () => {
    // A bare id is what the columns store, not an address.
    expect(parseOCCSessionAddress(SESSION_ID)).toBeNull()
    expect(parseOCCSessionAddress(null)).toBeNull()
    expect(parseOCCSessionAddress(undefined)).toBeNull()
    expect(parseOCCSessionAddress('')).toBeNull()
  })

  it.each([
    ['an unknown prefix', `pane:${SESSION_ID}`],
    ['the Run mailbox namespace', 'run:run_123'],
    ['the Dispatch mailbox namespace', 'dispatch:ctx_123'],
    ['an empty prefix', `:${SESSION_ID}`],
    ['an empty id', 'occ_session_id:'],
    ['an id with a separator', `occ_session_id:${SESSION_ID}:extra`],
    ['an id the session predicate rejects', 'occ_session_id:short'],
    ['a terminal handle', 'term_4f2c9a']
  ])('refuses %s', (_label, value) => {
    expect(parseOCCSessionAddress(value)).toBeNull()
  })

  it('no longer reads the retired session:<id> spelling as a session, as an address or a bare id', () => {
    expect(parseOCCSessionAddress(`session:${SESSION_ID}`)).toBeNull()
    expect(isOCCSessionId(`session:${SESSION_ID}`)).toBe(false)
  })

  it.each([
    ['a PTY terminal handle', 'term_4f2c9a1b-7d3e-4a5f-8b6c-9d0e1f2a3b4c'],
    ['a short PTY terminal handle', 'term_4f2c9a'],
    ['a structured-worker handle', 'structworker_4f2c9a1b-7d3e-4a5f-8b6c-9d0e1f2a3b4c']
  ])('never treats %s as an OCC session id', (_label, handle) => {
    // Handles share the session-id charset, so the session-record predicate alone would accept them.
    expect(isOCCSessionId(handle)).toBe(false)
    expect(parseOCCSessionAddress(`occ_session_id:${handle}`)).toBeNull()
  })

  it('validates an OCC session id with the session-record predicate', () => {
    expect(isOCCSessionId(SESSION_ID)).toBe(true)
    expect(isOCCSessionId('has space in it')).toBe(false)
    expect(isOCCSessionId('x'.repeat(129))).toBe(false)
  })
})
