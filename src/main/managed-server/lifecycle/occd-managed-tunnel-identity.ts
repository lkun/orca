// Open forwards prove no identity; require an authenticated status call from the pinned server.
import { parsePairingCode } from '../../../shared/pairing'
import {
  pairedRuntimeConnectionFromOffer,
  type PairedRuntimeConnection
} from '../../../shared/paired-runtime-connection'
import { OCCD_MANAGED_REMOTE_PORT } from '../../../shared/occd-managed-runtime'
import {
  isRecoverableRemoteRuntimeConnectionError,
  toRemoteRuntimeClientErrorLike
} from '../../../shared/remote-runtime/remote-runtime-client-error-classification'
import { RemoteRuntimeClientError } from '../../../shared/remote-runtime/remote-runtime-client-error'
import {
  getPreferredPairedRuntimeConnection,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { verifyRuntimePairingIdentity } from '../../runtime/runtime-environment-identity-verification'
import type { ServeReadiness } from '../../server/serve-readiness'
import { occdBoundPort } from './occd-managed-bound-port'
import { tunneledOCCdPairingCode } from '../../ssh/occd-tunneled-pairing'

/** Unreachable proves no identity; unpaired is a refusal sealed by the pinned server key. */
export type OCCdTunnelIdentity =
  | { verdict: 'verified' }
  | { verdict: 'foreign' | 'unreachable' | 'unpaired'; detail: string }

export const OCCD_IDENTITY_MISMATCH_CODE = 'occd_identity_mismatch'

export class OCCdManagedIdentityError extends Error {
  readonly code = OCCD_IDENTITY_MISMATCH_CODE
  constructor(remotePort: number, detail: string) {
    super(
      `${OCCD_IDENTITY_MISMATCH_CODE}: the server on remote port ${remotePort} is not this ` +
        `host’s OCC server (another OCC may be using that port): ${detail}`
    )
    this.name = 'OCCdManagedIdentityError'
  }
}

export const OCCD_PAIRING_REJECTED_CODE = 'occd_pairing_rejected'

export class OCCdManagedPairingRejectedError extends Error {
  readonly code = OCCD_PAIRING_REJECTED_CODE
  constructor(detail: string) {
    super(
      `${OCCD_PAIRING_REJECTED_CODE}: this host’s OCC server no longer accepts ` +
        `this desktop's pairing (its saved devices were reset, or this desktop was removed ` +
        `there), so reconnecting alone won't restore access: ${detail}`
    )
    this.name = 'OCCdManagedPairingRejectedError'
  }
}

export function occdIdentityRefusal(
  remotePort: number,
  identity: Exclude<OCCdTunnelIdentity, { verdict: 'verified' }>
): Error {
  return identity.verdict === 'unpaired'
    ? new OCCdManagedPairingRejectedError(identity.detail)
    : new OCCdManagedIdentityError(remotePort, identity.detail)
}

// Key rejection closes the socket instead of returning a status reply.
const FOREIGN_CLOSE_CODES = new Set([4001, 4003])

export function classifyOCCdTunnelIdentityFailure(error: unknown): OCCdTunnelIdentity {
  const detail = error instanceof Error ? error.message : String(error)
  // Only sealed access-grant refusals prove the pinned server answered.
  if (
    error instanceof RemoteRuntimeClientError &&
    error.code === 'unauthorized' &&
    error.pairingStage === 'access-grant'
  ) {
    return { verdict: 'unpaired', detail }
  }
  if (error instanceof RemoteRuntimeClientError && FOREIGN_CLOSE_CODES.has(error.closeCode ?? 0)) {
    return { verdict: 'foreign', detail }
  }
  return isRecoverableRemoteRuntimeConnectionError(toRemoteRuntimeClientErrorLike(error))
    ? { verdict: 'unreachable', detail }
    : { verdict: 'foreign', detail }
}

export async function verifyOCCdPairingIdentity(
  connection: PairedRuntimeConnection,
  expected: Pick<KnownRuntimeEnvironment, 'runtimeId' | 'pairedDeviceId'>
): Promise<OCCdTunnelIdentity> {
  try {
    await verifyRuntimePairingIdentity(connection, expected)
    return { verdict: 'verified' }
  } catch (error) {
    return classifyOCCdTunnelIdentityFailure(error)
  }
}

export function verifyManagedOCCdTunnelIdentity(
  environment: KnownRuntimeEnvironment
): Promise<OCCdTunnelIdentity> {
  if (!environment.occdDeployment) {
    return Promise.resolve({ verdict: 'verified' })
  }
  // Runtime/device IDs can change or become stale; pinned-key handshake and token acceptance prove identity.
  return verifyOCCdPairingIdentity(getPreferredPairedRuntimeConnection(environment), {
    runtimeId: null
  })
}

/** Fresh deploys have no saved pairing; reread readiness after foreign answers to follow port changes. */
export function deployedOCCdTunnelChecks(
  initial: ServeReadiness,
  rereadReadiness: () => Promise<ServeReadiness>
) {
  let readiness = initial
  return {
    readiness: () => readiness,
    remotePort: occdBoundPort(initial) ?? OCCD_MANAGED_REMOTE_PORT,
    rereadRemotePort: async () => {
      readiness = await rereadReadiness()
      return occdBoundPort(readiness) ?? OCCD_MANAGED_REMOTE_PORT
    },
    verify: async (localPort: number): Promise<OCCdTunnelIdentity> => {
      const pairing = parsePairingCode(tunneledOCCdPairingCode(readiness, localPort))
      return pairing
        ? verifyOCCdPairingIdentity(pairedRuntimeConnectionFromOffer(pairing), {
            runtimeId: readiness.runtimeId || null
          })
        : { verdict: 'foreign', detail: 'This host’s OCC server published an invalid pairing.' }
    }
  }
}
