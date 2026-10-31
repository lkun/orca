// Lost channels drop their sockets but keep the listener; tunnel reconnect logic owns recovery.
import { OCCdStdioBridgeUnavailableError } from '../../occd/occd-host-unavailable'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import {
  checkOCCdStdioBridge,
  openOCCdStdioBridgeChannel,
  resolveOCCdStdioBridge,
  type OCCdStdioBridge
} from '../../ssh/occd-stdio-bridge'
import { listenOCCdStdioBridge } from './occd-stdio-bridge-listener'
import { sshOCCdHostTransport } from '../../ssh/occd-ssh-host-transport'
import type { RemoteCommandChannel } from '../install/remote-install-transport'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import type {
  PortForwardStartOptions,
  SshPortForwardProvider,
  StartedPortForward
} from '../../ssh/port-forwarding/ssh-port-forward-provider'

export type OCCdStdioBridgeDependencies = {
  resolveBridge: (conn: OCCdHostTransport, port: number) => Promise<OCCdStdioBridge>
  checkBridge: (conn: OCCdHostTransport, bridge: OCCdStdioBridge) => Promise<unknown>
  openChannel: (conn: OCCdHostTransport, bridge: OCCdStdioBridge) => Promise<RemoteCommandChannel>
}

export const OCCD_STDIO_BRIDGE_DEPENDENCIES: OCCdStdioBridgeDependencies = {
  resolveBridge: resolveOCCdStdioBridge,
  checkBridge: checkOCCdStdioBridge,
  openChannel: openOCCdStdioBridgeChannel
}

export class OCCdStdioBridgePortForwardProvider implements SshPortForwardProvider {
  constructor(
    private readonly dependencies: OCCdStdioBridgeDependencies = OCCD_STDIO_BRIDGE_DEPENDENCIES
  ) {}

  canHandle(conn: SshConnection): boolean {
    return conn.getClient() !== null || conn.usesSystemSshTransport()
  }

  start(conn: SshConnection, options: PortForwardStartOptions): Promise<StartedPortForward> {
    return startOCCdStdioBridge(sshOCCdHostTransport(conn), options, this.dependencies)
  }
}

export async function startOCCdStdioBridge(
  host: OCCdHostTransport,
  options: PortForwardStartOptions,
  deps: OCCdStdioBridgeDependencies
): Promise<StartedPortForward> {
  let bridge: Promise<OCCdStdioBridge> | null = null
  // Retry failed bridge resolution on the next socket.
  const resolveBridge = (): Promise<OCCdStdioBridge> => {
    bridge ??= deps.resolveBridge(host, options.remotePort).catch((error: unknown) => {
      bridge = null
      throw error
    })
    return bridge
  }
  try {
    await deps.checkBridge(host, await resolveBridge())
  } catch (error) {
    if (error instanceof OCCdStdioBridgeUnavailableError) {
      throw error
    }
    // Lost contact does not prove bridge absence; let new sockets resolve it again.
    console.warn('[ssh] OCC stdio bridge check was unverifiable:', error)
  }
  return listenOCCdStdioBridge(options, async () => {
    const resolved = await resolveBridge()
    return { channel: await deps.openChannel(host, resolved), mode: resolved.mode }
  })
}
