import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import type { OCCdManagedServing } from './occd-managed-serving'
import { verifyManagedTunnelServing } from './occd-managed-tunnel'

/** Return unverifiable on failures rather than throwing. */
export function verifyOCCdManagedServing(
  userDataPath: string,
  selector: string
): Promise<OCCdManagedServing> {
  return Promise.resolve()
    .then(() => verifyManagedTunnelServing(resolveEnvironment(userDataPath, selector)))
    .catch((error: unknown) => ({ state: 'unverifiable', detail: String(error) }))
}
