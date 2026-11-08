/** E1: open a temporary bridge for incumbent census before activation. Unproven state is unverifiable, never zero; WSL has no standing deploy tunnel. */
import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'
import type { PairingOffer } from '../../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import { OCCD_MANAGED_REMOTE_PORT } from '../../../shared/occd-managed-runtime'
import {
  type OCCdTerminalCensus,
  UNVERIFIABLE_OCCD_TERMINAL_CENSUS
} from '../../../shared/occd-terminal-census'
import type { ServeReadiness } from '../../server/serve-readiness'
import { probeActiveOCCdReadiness } from '../../ssh/occd-active-readiness'
import { occdBoundPort } from '../../managed-server/lifecycle/occd-managed-bound-port'
import { managedOCCdInstallDir } from '../../managed-server/lifecycle/occd-managed-runtime-context'
import { wakeStoppedManagedOCCd } from '../../managed-server/lifecycle/occd-managed-wake'
import type { OCCdRemoteContext } from '../../managed-server/install/occd-remote-context'
import type { OCCdSlotOptions } from '../../ssh/occd-recovery-slot'
import { readRemoteOCCdBuildHash } from '../../managed-server/install/occd-remote-build-hash'
import {
  requestOCCdTerminalCensus,
  type OCCdTerminalCensusRequestOptions
} from '../../ssh/occd-terminal-census-client'
import { updateTerminalCounts } from '../../ssh/occd-fenced-stop'
import { tunneledOCCdPairingCode } from '../../ssh/occd-tunneled-pairing'
import type { StartedPortForward } from '../../ssh/port-forwarding/ssh-port-forward-provider'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import type { WslOCCdHostTarget } from './wsl-occd-host-target'
import { listenWslOCCdStdioBridge } from './wsl-occd-stdio-bridge'

export type WslOCCdIncumbent = {
  census: OCCdTerminalCensus
  /** The incumbent's proven readiness; null when it could not be started or proven. */
  readiness: ServeReadiness | null
  /** Recount without wake and close terminal admission before activation stops the incumbent; unreadable never means zero. */
  recount: () => Promise<OCCdTerminalCensus>
  /** Reopens the admission `recount` closed, when the incumbent keeps running. */
  releaseAdmission: () => Promise<void>
}

type IncumbentArgs = {
  context: OCCdRemoteContext<WslOCCdHostTarget>
  slot: OCCdSlotOptions
  /** This desktop's enrolled pairing; null before its first pairing. */
  paired?: PairingOffer | null
}

const UNREADABLE: WslOCCdIncumbent = {
  census: UNVERIFIABLE_OCCD_TERMINAL_CENSUS,
  readiness: null,
  recount: async () => UNVERIFIABLE_OCCD_TERMINAL_CENSUS,
  releaseAdmission: async () => {}
}

export type WslOCCdIncumbentDependencies = {
  wake: typeof wakeStoppedManagedOCCd
  probe: typeof probeActiveOCCdReadiness
  readBuildHash: typeof readRemoteOCCdBuildHash
  listen: (
    transport: OCCdHostTransport,
    remotePort: number,
    target: WslOCCdHostTarget
  ) => Promise<StartedPortForward>
  census: typeof requestOCCdTerminalCensus
}

const DEFAULT_DEPENDENCIES: WslOCCdIncumbentDependencies = {
  wake: wakeStoppedManagedOCCd,
  probe: probeActiveOCCdReadiness,
  readBuildHash: readRemoteOCCdBuildHash,
  listen: (transport, remotePort, target) =>
    listenWslOCCdStdioBridge(transport, {
      environmentId: target.id,
      distro: target.distro,
      remotePort,
      localPort: 0,
      label: `OCC server in WSL: ${target.label} (update check)`
    }),
  census: requestOCCdTerminalCensus
}

/** Wake reboot/idle-stopped incumbent, census its daemon, then close the temporary bridge before returning. */
export async function readWslOCCdIncumbent(
  args: IncumbentArgs,
  dependencies: WslOCCdIncumbentDependencies = DEFAULT_DEPENDENCIES
): Promise<WslOCCdIncumbent> {
  const record = args.context.activationRecord
  const activatedAt = record.activatedAt ? Date.parse(record.activatedAt) : Number.NaN
  if (!record.active || !Number.isFinite(activatedAt) || activatedAt < 0) {
    return UNREADABLE
  }
  let readiness: ServeReadiness
  try {
    const wake = await dependencies.wake(args.slot)
    if (wake.outcome === 'started') {
      readiness = wake.readiness
    } else if (wake.outcome === 'serving') {
      const remoteInstallDir = managedOCCdInstallDir(args.context, record.active)
      readiness = await dependencies.probe(
        { ...args.slot, remoteInstallDir },
        {
          buildHash: await dependencies.readBuildHash(args.slot, remoteInstallDir),
          fullVersion: record.active
        }
      )
    } else {
      return UNREADABLE
    }
  } catch {
    return UNREADABLE
  }
  const counts = updateTerminalCounts((options) =>
    countIncumbentTerminals(args, readiness, activatedAt, dependencies, options)
  )
  return {
    census: await counts.countFirst(),
    readiness,
    recount: counts.recountCensus,
    releaseAdmission: counts.releaseIncumbentAdmission
  }
}

async function countIncumbentTerminals(
  args: IncumbentArgs,
  readiness: ServeReadiness,
  activatedAt: number,
  dependencies: WslOCCdIncumbentDependencies,
  options: OCCdTerminalCensusRequestOptions
): Promise<OCCdTerminalCensus> {
  let forward: StartedPortForward | null = null
  try {
    forward = await dependencies.listen(
      args.slot.conn,
      occdBoundPort(readiness) ?? OCCD_MANAGED_REMOTE_PORT,
      args.context.target
    )
    // Use enrolled grants; startup offers would enroll a fresh device on every census.
    const offer = parsePairingCode(
      tunneledOCCdPairingCode(readiness, forward.entry.localPort, args.paired)
    )
    if (!offer) {
      return UNVERIFIABLE_OCCD_TERMINAL_CENSUS
    }
    return await dependencies.census(
      pairedRuntimeConnectionFromOffer(offer),
      activatedAt,
      undefined,
      options
    )
  } catch {
    return UNVERIFIABLE_OCCD_TERMINAL_CENSUS
  } finally {
    await forward?.close().catch(() => {})
  }
}
