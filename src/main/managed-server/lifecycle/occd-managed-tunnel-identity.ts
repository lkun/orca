// Open forwards prove no identity; require an authenticated status call from the pinned server.
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import {
  pairedRuntimeConnectionFromOffer,
  type PairedRuntimeConnection
} from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { OCCD_MANAGED_REMOTE_PORT } from '../../../shared/occd-managed-runtime'
import {
  isRecoverableRemoteRuntimeConnectionError,
  toRemoteRuntimeClientErrorLike
} from '../../../shared/remote-runtime/remote-runtime-client-error-classification'
import { RemoteRuntimeClientError } from '../../../shared/remote-runtime/remote-runtime-client-error'
import {
  getPreferredPairedRuntimeConnection,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { verifyRuntimePairingIdentity } from '../../runtime/hosts/identity/runtime-environment-identity-verification'
import type { ServeReadiness } from '../../server/serve-readiness'
import { occdBoundPort } from './occd-managed-bound-port'
import { tunneledOCCdPairingCode } from '../../ssh/occd-tunneled-pairing'
import { OCCdManagedPairingRepairFailedError } from './occd-managed-pairing-repair-failure'
import { quotePosixShellUnlessPlain } from '../../../shared/shell/launch/shell-argument-quoting'
import { RUNTIME_SERVER_REPLACED_STATUS_CODE } from '../../../shared/remote-runtime/host-status/runtime-host-status'

/** Unreachable proves no identity; unpaired is a refusal sealed by the pinned server key. */
export type OCCdTunnelIdentity =
  | { verdict: 'verified' }
  | { verdict: 'foreign' | 'unreachable' | 'unpaired'; detail: string }

export const OCCD_IDENTITY_MISMATCH_CODE = 'occd_identity_mismatch'

/** `foreign-port`: another process answered; `replaced-server`: the host's own slot serves another key. */
export type OCCdIdentityMismatchKind = 'foreign-port' | 'replaced-server'

export class OCCdManagedIdentityError extends Error {
  readonly code = OCCD_IDENTITY_MISMATCH_CODE
  private constructor(
    readonly kind: OCCdIdentityMismatchKind,
    explanation: string,
    detail: string
  ) {
    super(`${OCCD_IDENTITY_MISMATCH_CODE}: ${explanation}: ${detail}`)
    this.name = 'OCCdManagedIdentityError'
  }

  static foreignPort(remotePort: number, detail: string): OCCdManagedIdentityError {
    return new OCCdManagedIdentityError(
      'foreign-port',
      `the server on remote port ${remotePort} is not this host’s OCC server ` +
        '(another OCC may be using that port)',
      detail
    )
  }

  /** SSH access alone can't re-pin a different server key, so only the user can re-pair. */
  static replacedServer(
    environment: { id: string; name: string },
    detail: string
  ): OCCdManagedIdentityError {
    const environmentName = environment.name
    // Why the id: a name is free text, so pasting it into a shell could expand or pick another server.
    const selector = quotePosixShellUnlessPlain(environment.id)
    return new OCCdManagedIdentityError(
      'replaced-server',
      `${environmentName} is not the OCC server this desktop paired with (OCC now connects ` +
        'to the host as a different SSH user, or the server was reinstalled), so reconnecting ' +
        `won’t restore access. To pair with the host’s current server, open the ⋯ menu on ` +
        `${environmentName} in Settings › Remote OCC Servers and choose Forget… (or run ` +
        `\`occ environment forget --environment ${selector} --yes\`), then click ` +
        'Connect on the SSH host',
      detail
    )
  }
}

/** Status code of a refusal automatic retries can't clear (the pairing must change); null otherwise. */
export function managedOCCdRefusalNeedingUserCode(error: unknown): string | null {
  if (error instanceof OCCdManagedIdentityError && error.kind === 'replaced-server') {
    return RUNTIME_SERVER_REPLACED_STATUS_CODE
  }
  return error instanceof OCCdManagedPairingRepairFailedError ? 'unauthorized' : null
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
    : OCCdManagedIdentityError.foreignPort(remotePort, identity.detail)
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
