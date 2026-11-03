// The host records quit/update/crash on the cut-turn row for Continue. Unknown wire causes retain the row's words without a named cause.

export const AGENT_SESSION_OCC_STOP_CAUSES = ['update', 'quit', 'crash'] as const
/** The row's presentation, so a client that re-words host rows it can't name passes it through. */
export const AGENT_SESSION_OCC_STOP_PRESENTATION = 'occ-stop'
export type AgentSessionOCCStopCause = (typeof AGENT_SESSION_OCC_STOP_CAUSES)[number]
export type AgentSessionOCCStop = { cause: AgentSessionOCCStopCause }

export function isAgentSessionOCCStopCause(value: unknown): value is AgentSessionOCCStopCause {
  return AGENT_SESSION_OCC_STOP_CAUSES.some((cause) => cause === value)
}

/** The stop a row states, when this build knows its cause. */
export function readAgentSessionOCCStop(value: unknown): AgentSessionOCCStop | undefined {
  const cause =
    typeof value === 'object' && value !== null && 'cause' in value ? value.cause : undefined
  return isAgentSessionOCCStopCause(cause) ? { cause } : undefined
}
