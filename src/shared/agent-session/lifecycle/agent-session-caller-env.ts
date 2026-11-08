/** Injected session identity resolves the orchestration caller without guessing a terminal. Valid only on the same host/user: refuse claims across SSH, pairing or WSL, and omit it from SSH passthrough. */
import { OCC_SESSION_ADDRESS_PREFIX } from '../../occ-session-address-prefix'
import { isStructuredWorkerHandle } from '../../orchestration/workers/structured-worker-handle'

export const OCC_AGENT_SESSION_ID_ENV = 'OCC_AGENT_SESSION_ID'

/** The reservation token distinguishes its live child from a process that reused the PID. */
export const OCC_AGENT_SESSION_SPAWN_TOKEN_ENV = 'OCC_AGENT_SESSION_SPAWN_TOKEN'

export function readInjectedAgentSessionId(
  env: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
  const value = env[OCC_AGENT_SESSION_ID_ENV]?.trim()
  return value ? value : undefined
}

/** Match the resolved host mailbox address: workers retain their minted handle; other sessions use occ_session_id:<id>. The CLI cannot call the host resolver. */
export function injectedSessionAddress(
  env: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
  const sessionId = readInjectedAgentSessionId(env)
  if (!sessionId) {
    return undefined
  }
  const ownHandle = env.OCC_TERMINAL_HANDLE
  return isStructuredWorkerHandle(ownHandle)
    ? ownHandle
    : `${OCC_SESSION_ADDRESS_PREFIX}${sessionId}`
}
