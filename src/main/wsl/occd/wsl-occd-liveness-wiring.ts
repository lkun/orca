/** C7 supplies visible demand; these production probes serve the WSL liveness supervisor. */
import {
  probeThenWatchWslOCCdBridges,
  type WslOCCdBridgeActivity
} from './wsl-occd-bridge-activity'
import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import {
  type OCCdTerminalCensus,
  UNVERIFIABLE_OCCD_TERMINAL_CENSUS
} from '../../../shared/occd-terminal-census'
import { requestOCCdTerminalCensus } from '../../ssh/occd-terminal-census-client'
import { subscribeSystemPowerLifecycle } from '../../power/system-power-lifecycle'
import {
  deferUntilWslDistroRunning,
  readSettledConfirmedRunningWslDistros
} from '../discovery/wsl-background-distro-gate'
import type { WslDistroHolder } from '../discovery/wsl-distro-holder-types'
import { readWslGuestIdentity } from '../execution/wsl-guest-process-identity'
import type { WslOCCdConnection } from './wsl-occd-connection-types'
import type { WslOCCdConnectionManager } from './wsl-occd-connection'
import { defaultWslOCCdEnvironmentId } from './wsl-occd-deploy'
import { EXIT_SETTLE_MS } from './wsl-occd-liveness-evidence'
import { requireConfirmedRunning } from './wsl-occd-connection-errors'
import { WslOCCdLivenessSupervisor } from './wsl-occd-liveness-supervisor'
import { createWslOCCdHostTransport } from './wsl-occd-host-transport'
import { openWslOCCdWatch } from './wsl-occd-watch'

function transportFor(distro: string, environmentId = defaultWslOCCdEnvironmentId(distro)) {
  return createWslOCCdHostTransport({
    target: { kind: 'wsl', id: environmentId, distro, label: distro }
  })
}

/** Every session counts (activation time 0): liveness asks how many survived, not how new. */
function collectWslOCCdCensus(connection: WslOCCdConnection): Promise<OCCdTerminalCensus> {
  const offer = parsePairingCode(connection.pairingOffer)
  return offer
    ? requestOCCdTerminalCensus(pairedRuntimeConnectionFromOffer(offer), 0)
    : Promise.resolve(UNVERIFIABLE_OCCD_TERMINAL_CENSUS)
}

export function createWslOCCdLivenessSupervisor(options: {
  manager: WslOCCdConnectionManager
  bridgeActivity: WslOCCdBridgeActivity
  holder: WslDistroHolder
  hasUserVisibleWork: (distro: string) => boolean
}): WslOCCdLivenessSupervisor {
  return new WslOCCdLivenessSupervisor({
    manager: options.manager,
    readRunning: ({ distro, exitedAt, probedAfter }) => {
      const settled =
        exitedAt === null || exitedAt === undefined ? undefined : exitedAt + EXIT_SETTLE_MS
      return readSettledConfirmedRunningWslDistros(
        distro,
        probedAfter === undefined ? settled : Math.max(settled ?? -Infinity, probedAfter)
      )
    },
    readIdentity: (distro, occdPid) => readWslGuestIdentity(transportFor(distro), occdPid),
    openWatch: (connection) =>
      probeThenWatchWslOCCdBridges(
        () =>
          openWslOCCdWatch(
            transportFor(connection.distro, connection.environmentId),
            connection.remotePort
          ),
        options.bridgeActivity,
        connection.environmentId
      ),
    collectCensus: collectWslOCCdCensus,
    hasUserVisibleWork: options.hasUserVisibleWork,
    deferUntilRunning: deferUntilWslDistroRunning,
    requireRunning: async (distro) =>
      requireConfirmedRunning(await readSettledConfirmedRunningWslDistros(distro), distro),
    // Liveness is background work: the holder may re-spawn only into a distro that runs (E9).
    ensureHolder: (distro) =>
      options.holder.ensureHeld(distro, {
        requireRunning: async () =>
          requireConfirmedRunning(await readSettledConfirmedRunningWslDistros(distro), distro)
      }),
    subscribePower: subscribeSystemPowerLifecycle
  })
}
