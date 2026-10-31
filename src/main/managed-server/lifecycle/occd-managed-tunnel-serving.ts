// Reread readiness after unanswered tunnels: another desktop may have restarted occd on a new port.
import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { OCCdManagedServing } from './occd-managed-serving'
import type { OCCdManagedServingCheck } from './occd-managed-tunnel-resume'
import type { ActiveOCCdTunnel } from './occd-managed-tunnel-active'
import type { SshPortForwardManager } from '../../ssh/port-forwarding/ssh-port-forward'
import type { SshTarget } from '../../../shared/ssh-types'
import type { OCCdManagedTunnelTargeting } from './occd-managed-tunnel-target'

export type OCCdTunnelServing = OCCdManagedServing & { rebind?: true }

export async function checkManagedTunnelServing(input: {
  environment: KnownRuntimeEnvironment
  active: Map<string, ActiveOCCdTunnel>
  getTarget: (targetId: string) => SshTarget | null | undefined
  forwards: Pick<SshPortForwardManager, 'removeForwardAndWait'>
  ensureServing: OCCdManagedServingCheck | undefined
  readPublishedPort?: OCCdManagedTunnelTargeting['readPublishedPort']
}): Promise<OCCdTunnelServing> {
  const { environment, active: tunnels } = input
  const active = tunnels.get(environment.id)
  const target = active && input.getTarget(active.targetId)
  if (!active || !target || !input.ensureServing) {
    return { state: 'unverifiable', detail: 'The tunnel to this host’s OCC server is not up.' }
  }
  const serving = await input.ensureServing({
    environment,
    target,
    connection: active.connection,
    remotePort: active.remotePort
  })
  const boundPort =
    serving.state === 'started'
      ? serving.boundPort
      : serving.state === 'unverifiable'
        ? ((await input.readPublishedPort?.({
            environment,
            target,
            connection: active.connection
          })) ?? null)
        : null
  if (boundPort === null || boundPort === active.remotePort) {
    return serving
  }
  if (tunnels.get(environment.id) === active) {
    tunnels.delete(environment.id)
  }
  await input.forwards.removeForwardAndWait(active.forwardId)
  return { ...serving, rebind: true }
}
