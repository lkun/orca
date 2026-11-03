import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import type { ServeReadiness } from '../../server/serve-readiness'
import { readOCCdActivationRecord } from '../activation/occd-activation-record-store'
import {
  occdSlotDir,
  resolveOCCdSlotIdentity,
  type OCCdSlotOptions
} from '../../ssh/occd-recovery-slot'
import { probeActiveOCCdReadiness } from '../../ssh/occd-active-readiness'
import { gcOldOCCdVersions } from '../install/occd-remote-gc'
import { nodeRuntimeStorePins } from '../../ssh/pinned-runtime-host-target'

/** null proves no daemon; undefined means its version is unknown. */
export function provenLiveDaemonVersion(readiness: ServeReadiness): string | null | undefined {
  const daemon = readiness.health?.terminalDaemon
  if (daemon?.state === 'live' && daemon.buildVersion) {
    return daemon.buildVersion
  }
  return daemon?.state === 'absent' ? null : undefined
}

export type ManagedOCCdPruneArgs = {
  slot: OCCdSlotOptions
  serverTarget: NodeRuntimeTarget
  activeVersion: string
  readiness: ServeReadiness
  keepStagedWithinDays?: number
}

/** True only when GC ran and left no stale version dir behind. */
export async function pruneManagedOCCdVersions(args: ManagedOCCdPruneArgs): Promise<boolean> {
  const liveDaemonVersion = provenLiveDaemonVersion(args.readiness)
  // Unknown daemon versions could still execute from any candidate tree; skip GC.
  if (liveDaemonVersion === undefined) {
    return false
  }
  try {
    return await gcOldOCCdVersions({
      conn: args.slot.conn,
      host: args.slot.host,
      remoteHome: args.slot.remoteHome,
      currentDirAbsPath: occdSlotDir(args.slot, args.activeVersion),
      record: await readOCCdActivationRecord(args.slot),
      liveDaemonVersion,
      // Default and compat builds share one runtime store.
      nodeRuntimePins: nodeRuntimeStorePins(args.serverTarget),
      ...(args.keepStagedWithinDays !== undefined
        ? { keepStagedWithinDays: args.keepStagedWithinDays }
        : {}),
      signal: args.slot.signal
    })
  } catch (error) {
    // Cleanup must not fail completed deploys; later connects retry.
    console.warn('[occd-gc] Pruning old occd versions failed:', error)
    return false
  }
}

/** GC otherwise runs only after an activation, so each deferred release left its staged slot behind (#34149). */
export async function pruneSupersededOCCdCandidates(
  slot: OCCdSlotOptions,
  serverTarget: NodeRuntimeTarget,
  candidateVersion: string
): Promise<void> {
  let readiness: ServeReadiness
  try {
    const active = (await readOCCdActivationRecord(slot)).active
    if (!active) {
      return
    }
    readiness = await probeOCCdSlotReadiness(slot, active)
  } catch (error) {
    // Without the incumbent's daemon version a staged tree may still be executing.
    console.warn('[occd-gc] Skipped pruning staged occd versions:', error)
    return
  }
  await pruneManagedOCCdVersions({
    slot,
    serverTarget,
    activeVersion: candidateVersion,
    readiness,
    keepStagedWithinDays: STAGED_BUILD_KEEP_DAYS
  })
}

/** Readiness of the occd serving `version`, which names its live terminal daemon's build. */
export async function probeOCCdSlotReadiness(
  slot: OCCdSlotOptions,
  version: string
): Promise<ServeReadiness> {
  const identity = await resolveOCCdSlotIdentity(slot, version)
  return probeActiveOCCdReadiness(
    { ...slot, remoteInstallDir: identity.remoteDir },
    { buildHash: identity.buildHash, fullVersion: identity.version }
  )
}

// Desktops on different releases share hosts; without a grace period each re-uploads what the other pruned.
const STAGED_BUILD_KEEP_DAYS = 3
