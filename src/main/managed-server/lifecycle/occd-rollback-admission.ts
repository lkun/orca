import type { OCCdTerminalCensus } from '../../../shared/occd-terminal-census'
import type { OCCdRollbackResult } from '../install/occd-remote-rollback'

export function rollbackRecountRefusal(census: OCCdTerminalCensus): OCCdRollbackResult | null {
  const live = census.liveSessions
  if (live === 0) {
    return null
  }
  return {
    outcome: 'refused',
    code: live === null ? 'occd_rollback_census_unavailable' : 'occd_rollback_terminals_running',
    reason:
      live === null
        ? 'The server did not answer how many terminals it runs. Retry when it answers.'
        : 'A terminal opened on this server before it could be stopped; close it, then retry.'
  }
}

export const ROLLBACK_STALE_COUNT: OCCdRollbackResult = {
  outcome: 'refused',
  code: 'occd_rollback_census_unavailable',
  reason: 'The terminal count went stale before the server could be stopped. Retry the rollback.'
}
