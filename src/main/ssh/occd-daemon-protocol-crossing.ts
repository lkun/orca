/** Daemons outlive occd swaps; incoming builds can attach only current/previous daemon protocols, matching config/scripts/daemon-protocol-facts.mjs canAttach. */
import {
  PREVIOUS_DAEMON_PROTOCOL_VERSIONS,
  PROTOCOL_VERSION
} from '../daemon/daemon-protocol-version'
import type { OCCdTerminalCensus } from '../../shared/occd-terminal-census'

export type OCCdDaemonProtocolFacts = {
  protocolVersion: number
  previousProtocolVersions: readonly number[]
}

export const CURRENT_OCCD_DAEMON_PROTOCOL: OCCdDaemonProtocolFacts = {
  protocolVersion: PROTOCOL_VERSION,
  previousProtocolVersions: PREVIOUS_DAEMON_PROTOCOL_VERSIONS
}

export function occdBuildCanAttachDaemon(
  reader: OCCdDaemonProtocolFacts,
  ownerProtocolVersion: number
): boolean {
  return (
    reader.protocolVersion === ownerProtocolVersion ||
    reader.previousProtocolVersions.includes(ownerProtocolVersion)
  )
}

export type OCCdLiveDaemonCrossing =
  | { state: 'no-live-terminals' }
  | { state: 'attachable' }
  | { state: 'strands-live-terminals'; unattachable: readonly number[] }
  | { state: 'unverifiable' }

/** A counted census of live terminals from a host that predates the protocol set, so it cannot name mixed generations. */
export function censusNeedsHostDaemonProtocols(census: OCCdTerminalCensus): boolean {
  // An uncounted census may hide in-process terminals no daemon answer can vouch for.
  return (
    census.liveSessions !== null &&
    census.liveSessions > 0 &&
    census.daemonProtocolVersions === undefined &&
    census.daemonProtocolVersion === null
  )
}

function liveDaemonProtocols(
  census: OCCdTerminalCensus,
  hostDaemonProtocols: readonly number[] | undefined
): readonly number[] | null {
  if (census.daemonProtocolVersions !== undefined) {
    return census.daemonProtocolVersions
  }
  if (census.daemonProtocolVersion !== null) {
    return [census.daemonProtocolVersion]
  }
  return censusNeedsHostDaemonProtocols(census) ? (hostDaemonProtocols ?? null) : null
}

/** An unknown session count or daemon protocol is planned for as live and unattachable. */
export function assessOCCdLiveDaemonCrossing(
  census: OCCdTerminalCensus,
  incoming: OCCdDaemonProtocolFacts,
  /** Every daemon generation alive on the host, as the incoming build observed it. */
  hostDaemonProtocols?: readonly number[]
): OCCdLiveDaemonCrossing {
  if (census.liveSessions === 0) {
    return { state: 'no-live-terminals' }
  }
  const protocols = liveDaemonProtocols(census, hostDaemonProtocols)
  if (protocols === null || protocols.length === 0) {
    return { state: 'unverifiable' }
  }
  // Every generation must stay reachable; one unattachable daemon strands its terminals.
  const unattachable = protocols.filter(
    (protocol) => !occdBuildCanAttachDaemon(incoming, protocol)
  )
  return unattachable.length === 0
    ? { state: 'attachable' }
    : { state: 'strands-live-terminals', unattachable }
}

export function describeDaemonProtocols(protocols: readonly number[]): string {
  return protocols.length === 1 ? `protocol ${protocols[0]}` : `protocols ${protocols.join(', ')}`
}
