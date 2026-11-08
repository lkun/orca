export const PI_PROCESS_OWNER_ENV_KEYS = [
  'OCC_PI_STATUS_OWNED',
  'OCC_PRIME_AGENT_STATUS_OWNED',
  'OCC_PI_TITLE_MARKER_OWNED'
] as const

/** A new terminal is not a child agent in the pane that launched its host. */
export function stripPiProcessOwnerEnv(env: Record<string, string | undefined>): void {
  for (const key of PI_PROCESS_OWNER_ENV_KEYS) {
    delete env[key]
  }
}
