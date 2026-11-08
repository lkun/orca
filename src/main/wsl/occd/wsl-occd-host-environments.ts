/** Map currently connected runtime IDs to WSL distros for desktop account shims; connection manager removes entries on close. */
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'

const distrosByEnvironment = new Map<string, string>()
/** The capabilities the connected occd last reported; dropped on every (re)connect. */
const capabilitiesByEnvironment = new Map<string, readonly string[]>()

export function registerWslOCCdHostEnvironment(environmentId: string, distro: string): void {
  distrosByEnvironment.set(environmentId, distro)
  // Reconnect may deploy a different build; discard cached capabilities.
  capabilitiesByEnvironment.delete(environmentId)
}

export function unregisterWslOCCdHostEnvironment(environmentId: string, distro: string): void {
  if (distrosByEnvironment.get(environmentId) === distro) {
    distrosByEnvironment.delete(environmentId)
    capabilitiesByEnvironment.delete(environmentId)
  }
}

export function wslOCCdHostDistro(environmentId: string): string | null {
  return distrosByEnvironment.get(environmentId) ?? null
}

type WslOCCdHostEnvironmentRef = { environmentId: string; distro: string }

/** Lists `next` while open; a closed connection (`next` null) unlists `previous`. */
export function trackWslOCCdHostEnvironment(
  previous: WslOCCdHostEnvironmentRef,
  next: WslOCCdHostEnvironmentRef | null
): void {
  if (next) {
    registerWslOCCdHostEnvironment(next.environmentId, next.distro)
  } else {
    unregisterWslOCCdHostEnvironment(previous.environmentId, previous.distro)
  }
}

function capabilitiesOf(result: unknown): readonly string[] | null {
  if (typeof result !== 'object' || result === null || !('capabilities' in result)) {
    return null
  }
  const { capabilities } = result
  return Array.isArray(capabilities)
    ? capabilities.filter((entry): entry is string => typeof entry === 'string')
    : null
}

/** Records a WSL occd's capabilities from any `status.get` answer that passes the desktop. */
const AUTOMATION_MUTATIONS = new Set([
  'automation.create',
  'automation.update',
  'automation.delete'
])
const automationMutationListeners = new Set<(environmentId: string) => void>()

/** E9: this desktop changed a WSL host's automations; the wake schedule re-reads them. */
export function onWslOCCdHostAutomationsChanged(
  listener: (environmentId: string) => void
): () => void {
  automationMutationListeners.add(listener)
  return () => automationMutationListeners.delete(listener)
}

export function observeWslOCCdHostResponse(
  environmentId: string,
  method: string,
  response: RuntimeRpcResponse<unknown>
): void {
  if (!response.ok || !distrosByEnvironment.has(environmentId)) {
    return
  }
  if (AUTOMATION_MUTATIONS.has(method)) {
    automationMutationListeners.forEach((listener) => listener(environmentId))
    return
  }
  if (method !== 'status.get') {
    return
  }
  const capabilities = capabilitiesOf(response.result)
  if (capabilities) {
    capabilitiesByEnvironment.set(environmentId, capabilities)
  }
}

export type WslOCCdHostCapabilityVerdict = 'supported' | 'unsupported' | 'unknown'

/** Cache advertised capabilities until reconnect. Probe failure is unknown, never proof of an older host. */
export async function wslOCCdHostSupports(
  environmentId: string,
  capability: string,
  readStatus: () => Promise<RuntimeRpcResponse<unknown>>
): Promise<WslOCCdHostCapabilityVerdict> {
  if (!capabilitiesByEnvironment.has(environmentId)) {
    try {
      observeWslOCCdHostResponse(environmentId, 'status.get', await readStatus())
    } catch {
      return 'unknown'
    }
  }
  const capabilities = capabilitiesByEnvironment.get(environmentId)
  if (!capabilities) {
    return 'unknown'
  }
  return capabilities.includes(capability) ? 'supported' : 'unsupported'
}
