import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import type { OCCdTunnelIdentity } from '../../managed-server/lifecycle/occd-managed-tunnel-identity'
import type { ServeReadiness } from '../../server/serve-readiness'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import type { StartedPortForward } from '../../ssh/port-forwarding/ssh-port-forward-provider'
import type { WslDistroHolder } from '../discovery/wsl-distro-holder-types'
import type { WslOCCdConnectionStatus } from './wsl-occd-connection-status'
import type {
  WslOCCdDeferredUpdate,
  WslOCCdDeployOptions,
  WslOCCdLaunch
} from './wsl-occd-deploy'
import type { WslOCCdHostTarget } from './wsl-occd-host-target'
import type { WslOCCdPairingRecovery } from './wsl-occd-pairing-identity'
import type { WslOCCdStdioBridgeOptions } from './wsl-occd-stdio-bridge'

/** One open bridge to a distro's occd, as the connection manager publishes it. */
export type WslOCCdConnection = {
  distro: string
  environmentId: string
  /** The loopback port on this machine the pairing offer points at. */
  localPort: number
  /** occd's port inside the distro. */
  remotePort: number
  fullVersion: string
  /** occd's pid inside the distro, from its pid file; null when unreadable. */
  pid: number | null
  /** occd's pairing code, with its endpoint rewritten to `ws://127.0.0.1:<localPort>`. */
  pairingOffer: string
  /** An app update the incumbent `fullVersion` is waiting to take (live terminals). */
  deferredUpdate: WslOCCdDeferredUpdate | null
  close(): Promise<void>
}

export type WslOCCdConnectionDependencies = {
  holder?: WslDistroHolder
  getPairingOffer?: (environmentId: string) => PairingOffer | null
  /** The bridge port the host's record saved: rebinding it keeps the pairing across app restarts. */
  recordedLocalPort?: (environmentId: string) => number | null
  deployAndLaunch?: (distro: string, options: WslOCCdDeployOptions) => Promise<WslOCCdLaunch>
  createTransport?: (target: WslOCCdHostTarget) => OCCdHostTransport
  listen?: (
    transport: OCCdHostTransport,
    options: WslOCCdStdioBridgeOptions
  ) => Promise<StartedPortForward>
  verifyIdentity?: (pairingOffer: string, readiness: ServeReadiness) => Promise<OCCdTunnelIdentity>
  /** Re-pairs a refused enrolled token; without it a refusal fails the connect. */
  pairingRecovery?: Omit<WslOCCdPairingRecovery, 'environmentId'>
  /** A connection (re)opened, its offer changed, or its status moved; null once it closed. */
  onChange?: (
    distro: string,
    connection: WslOCCdConnection | null,
    status: WslOCCdConnectionStatus
  ) => void
}
