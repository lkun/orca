import { afterEach, describe, expect, it } from 'vitest'
import { injectedSessionAddress } from '../../../shared/agent-session-caller-env'
import { testOCCSessionId } from '../../../shared/occ-session-address-test-fixture'
import {
  mintStructuredWorkerHandle,
  mintStructuredWorkerPaneKey,
  structuredWorkerIdentities,
  structuredWorkerProcessIncarnation
} from '../structured-worker-identity'
import { resolveOCCSessionParty } from './orchestration-party'

// The CLI formats its address before host resolution; both paths must name the same mailbox.
const CHAT = testOCCSessionId('f7a1c0de-1111-4222-8333-444455556666')
const WORKER = testOCCSessionId('a0b1c2d3-0000-4000-8000-00000000abcd')

afterEach(() => {
  structuredWorkerIdentities.clear()
})

describe("the CLI's own address", () => {
  it("is a chat's session address, even beside a pane handle it inherited", () => {
    const hostAddress = resolveOCCSessionParty(CHAT, null).address
    expect(injectedSessionAddress({ OCC_AGENT_SESSION_ID: CHAT })).toBe(hostAddress)
    expect(
      injectedSessionAddress({
        OCC_AGENT_SESSION_ID: CHAT,
        OCC_TERMINAL_HANDLE: 'term_inherited'
      })
    ).toBe(hostAddress)
  })

  it("is a structured worker's minted handle, as the host resolves it", () => {
    const handle = mintStructuredWorkerHandle()
    structuredWorkerIdentities.register({
      handle,
      sessionId: WORKER,
      agent: 'claude',
      paneKey: mintStructuredWorkerPaneKey(WORKER),
      processIncarnation: structuredWorkerProcessIncarnation(WORKER),
      worktreeId: 'wt_1',
      hostScope: { kind: 'local', hostId: 'local' }
    })
    const hostAddress = resolveOCCSessionParty(WORKER, null).address
    expect(hostAddress).toBe(handle)
    expect(
      injectedSessionAddress({ OCC_AGENT_SESSION_ID: WORKER, OCC_TERMINAL_HANDLE: handle })
    ).toBe(hostAddress)
  })
})
