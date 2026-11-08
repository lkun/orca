/** Unknown failures, including older hosts without census support, stay unverifiable and never mean zero live terminals. */
import { OCCD_TERMINAL_CENSUS_RUNTIME_CAPABILITY } from '../../shared/occd-runtime-capabilities'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../shared/electron-remote-runtime-client-capabilities'
import type { PairedRuntimeConnection } from '../../shared/remote-runtime/pairing/paired-runtime-connection'
import {
  getPreferredPairedRuntimeConnection,
  type KnownRuntimeEnvironment
} from '../../shared/remote-runtime/host-catalog/runtime-environments'
import {
  OCCD_TERMINAL_CENSUS_METHOD,
  OCCdTerminalCensusSchema,
  type OCCdTerminalCensus,
  UNVERIFIABLE_OCCD_TERMINAL_CENSUS
} from '../../shared/occd-terminal-census'
import { sendRemoteRuntimeRequestWithStatusPreflight } from '../../shared/remote-runtime/remote-runtime-client'
import type { OCCdActivationRecord } from '../managed-server/activation/occd-activation-record'
import { ensureOCCdManagedTunnel } from '../managed-server/lifecycle/occd-managed-tunnel'
import { verifyOCCdManagedServing } from '../managed-server/lifecycle/occd-managed-serving-verify'

export type OCCdTerminalCensusRequestOptions = {
  releaseFinishedAutomationTerminals?: boolean
  /** Close the server's terminal admission this long before counting; 0 reopens it. */
  closeAdmissionForMs?: number
}

/** Wake idle servers behind ensured tunnels; failed wake/tunnel stays unverifiable. */
export async function collectManagedTerminalCensus(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  record: OCCdActivationRecord,
  timeoutMs = 15_000,
  options: OCCdTerminalCensusRequestOptions = {}
): Promise<OCCdTerminalCensus> {
  if (!record.active) {
    return { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
  }
  const activatedAt = record.activatedAt ? Date.parse(record.activatedAt) : Number.NaN
  if (!Number.isFinite(activatedAt) || activatedAt < 0) {
    return UNVERIFIABLE_OCCD_TERMINAL_CENSUS
  }
  try {
    // Use the tunnel's returned pairing; re-pairing may have retired the caller's token.
    const current = await ensureOCCdManagedTunnel(userDataPath, environment.id)
    // Wake before census, except for reopen: a stopped server has no admission to release.
    if (options.closeAdmissionForMs !== 0) {
      await verifyOCCdManagedServing(userDataPath, environment.id)
    }
    return await requestOCCdTerminalCensus(
      getPreferredPairedRuntimeConnection(current),
      activatedAt,
      timeoutMs,
      options
    )
  } catch {
    return UNVERIFIABLE_OCCD_TERMINAL_CENSUS
  }
}

export async function requestOCCdTerminalCensus(
  connection: PairedRuntimeConnection,
  activatedAt: number,
  timeoutMs = 15_000,
  options: OCCdTerminalCensusRequestOptions = {}
): Promise<OCCdTerminalCensus> {
  try {
    const response = await sendRemoteRuntimeRequestWithStatusPreflight<unknown>(
      connection,
      OCCD_TERMINAL_CENSUS_METHOD,
      {
        activatedAt,
        ...(options.releaseFinishedAutomationTerminals
          ? { releaseFinishedAutomationTerminals: true }
          : {}),
        // Older servers safely omit both unsupported admission request and reply fields.
        ...(options.closeAdmissionForMs === undefined
          ? {}
          : { closeAdmissionForMs: options.closeAdmissionForMs })
      },
      timeoutMs,
      (status) => {
        if (
          !status.ok ||
          !status.result.capabilities?.includes(OCCD_TERMINAL_CENSUS_RUNTIME_CAPABILITY)
        ) {
          throw new Error('This host’s OCC server does not report a terminal census.')
        }
      },
      undefined,
      ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES
    )
    return response.ok
      ? OCCdTerminalCensusSchema.parse(response.result)
      : UNVERIFIABLE_OCCD_TERMINAL_CENSUS
  } catch {
    return UNVERIFIABLE_OCCD_TERMINAL_CENSUS
  }
}
