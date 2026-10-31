import type { ServeReadiness } from '../server/serve-readiness'
import type { OCCRuntimeRpcServer } from '../runtime/runtime-rpc'
import { buildServePairingReadiness } from '../server/serve-pairing-readiness'
import type { OCCdHealth } from './occd-health'
import type { OCCdOptions } from './occd-start-contract'

export async function buildOCCdServeReadiness(input: {
  options: OCCdOptions
  runtimeId: string
  rpc: Pick<OCCRuntimeRpcServer, 'getWebSocketEndpoint' | 'createPairingOffer'>
  collectHealth: () => Promise<OCCdHealth>
}): Promise<ServeReadiness> {
  return {
    runtimeId: input.runtimeId,
    ...(await buildServePairingReadiness(input.options, input.rpc)),
    // WSL CLI reconciliation runs only in desktop launch, so no repair is pending here.
    managedWslCliReconciliation: 'settled',
    // Deployers inspect readiness health to reject hosts whose terminal daemon is unavailable.
    health: await input.collectHealth()
  }
}
