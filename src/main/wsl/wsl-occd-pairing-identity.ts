import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import type { ServeReadiness } from '../server/serve-readiness'
import {
  occdIdentityRefusal,
  verifyOCCdPairingIdentity,
  type OCCdTunnelIdentity
} from '../managed-server/lifecycle/occd-managed-tunnel-identity'
import { tunneledOCCdPairingCode } from '../ssh/occd-tunneled-pairing'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'
import {
  buildWithPairingRepair,
  type ManagedOCCdPairingRecovery
} from '../managed-server/lifecycle/occd-managed-tunnel-pairing-recovery'
import type { WslOCCdLaunch } from './wsl-occd-deploy'

/** The managed repair gate a refused enrolled token goes through, for one WSL host. */
export type WslOCCdPairingRecovery = Omit<ManagedOCCdPairingRecovery, 'ensure'> & {
  environmentId: string
}

/** Reconnect with enrolled token/pinned host key. Repair refusal once through the gate and verify the replacement; startup offers are for enrollment only. */
export async function resolveWslOCCdPairing(
  launch: Extract<WslOCCdLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity = verifyWslOCCdIdentity,
  recovery?: WslOCCdPairingRecovery
): Promise<string> {
  const verified = (offer: PairingOffer | null) =>
    verifyWslOCCdPairing(launch, localPort, offer, verifyIdentity)
  // First-time pairing has no enrolled token to repair.
  if (!recovery || !paired) {
    return verified(paired)
  }
  let pairingOffer = ''
  await buildWithPairingRepair(
    {
      ...recovery,
      ensure: async (environment) => {
        pairingOffer = await verified(getPreferredPairingOffer(environment))
      }
    },
    recovery.environmentId,
    async () => {
      pairingOffer = await verified(paired)
    }
  )
  return pairingOffer
}

async function verifyWslOCCdPairing(
  launch: Extract<WslOCCdLaunch, { outcome: 'ready' }>,
  localPort: number,
  paired: PairingOffer | null,
  verifyIdentity: typeof verifyWslOCCdIdentity
): Promise<string> {
  const pairingOffer = tunneledOCCdPairingCode(launch.readiness, localPort, paired)
  const identity = await verifyIdentity(pairingOffer, launch.readiness)
  if (identity.verdict === 'foreign' || identity.verdict === 'unpaired') {
    throw occdIdentityRefusal(launch.port, identity)
  }
  if (identity.verdict === 'unreachable') {
    console.warn(
      `[wsl] OCC server in ${launch.distro} did not answer its bridge: ${identity.detail}`
    )
  }
  return pairingOffer
}

/** Whether the server behind a WSL bridge is the occd that published `readiness`. */
export async function verifyWslOCCdIdentity(
  pairingOffer: string,
  readiness: ServeReadiness
): Promise<OCCdTunnelIdentity> {
  const offer = parsePairingCode(pairingOffer)
  return offer
    ? verifyOCCdPairingIdentity(pairedRuntimeConnectionFromOffer(offer), {
        runtimeId: readiness.runtimeId || null
      })
    : { verdict: 'foreign', detail: 'The OCC server in WSL published an invalid pairing offer.' }
}
