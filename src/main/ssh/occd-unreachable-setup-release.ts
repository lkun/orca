/** Release conversion setups stranded before staging by refused SSH forwarding. Stop any activated slot, unregister, then use undeployed-fence release; source rows remain intact for retry. */
import { listEnvironments } from '../../shared/runtime-environment-store'
import { removeManagedOCCdEnvironment } from '../../shared/runtime-environment-managed-occd-store'
import { findOCCdMigrationSourceCutoverForTarget } from './occd-migration-cutover-journal'
import { releaseUndeployedMigrationFence } from './occd-migration-source-fence'
import { closeOCCdManagedTunnel } from '../managed-server/lifecycle/occd-managed-tunnel'
import type { SshTargetOCCdClaims } from './targets/ssh-target-occd-claims'
import { withOCCdActivationLock } from '../managed-server/activation/occd-activation-lock'
import { withDeactivatedVersionCommitted } from '../managed-server/activation/occd-activation-record'
import {
  readOCCdActivationRecord,
  writeOCCdActivationRecord
} from '../managed-server/activation/occd-activation-record-store'
import { managedOCCdSlot } from '../managed-server/lifecycle/occd-managed-runtime-context'
import { resolveOCCdRemoteContext } from '../managed-server/install/occd-remote-context'
import { occdStopFreedTheHost } from '../managed-server/install/occd-remote-process-control'
import { occdSlotDir, stopOCCdSlot } from './occd-recovery-slot'
import { sshOCCdHostTransport } from './occd-ssh-host-transport'
import { getSshConnectionManager, getSshTargetRegistryStore } from './targets/ssh-target-registry'
import { errorMessage } from '../../shared/error-message'

export async function releaseUnreachableOCCdSetup(args: {
  userDataPath: string
  claims: SshTargetOCCdClaims
  targetId: string
  signal?: AbortSignal
}): Promise<void> {
  const cutover = findOCCdMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Staged/committed destinations require their own evidence before release.
  if (cutover?.phase !== 'source-fenced') {
    return
  }
  const environmentId = cutover.destinationEnvironmentId
  await closeOCCdManagedTunnel(environmentId).catch(() => undefined)
  await stopStrandedOCCd(args.targetId, args.signal).catch((error: unknown) => {
    console.warn(`[occd] Could not stop the unreachable setup's server: ${errorMessage(error)}`)
  })
  const isRegistered = (id: string): boolean =>
    listEnvironments(args.userDataPath).some((entry) => entry.id === id)
  // Unregister first so an interrupted release leaves a recoverable undeployed fence.
  if (isRegistered(environmentId)) {
    removeManagedOCCdEnvironment(args.userDataPath, environmentId)
  }
  await releaseUndeployedMigrationFence({
    userDataPath: args.userDataPath,
    claims: args.claims,
    targetId: args.targetId,
    isDestinationRegistered: isRegistered,
    signal: args.signal
  })
}

/** Clear active only after proven slot exit; daemon terminals may outlive it. */
async function stopStrandedOCCd(targetId: string, signal?: AbortSignal): Promise<void> {
  const target = getSshTargetRegistryStore()?.getTarget(targetId)
  const connectionManager = getSshConnectionManager()
  if (!target || !connectionManager) {
    return
  }
  const context = await resolveOCCdRemoteContext(
    target,
    sshOCCdHostTransport(await connectionManager.connect(target)),
    signal
  )
  if (!context.activationRecord.active) {
    return
  }
  // Port is irrelevant because this recovery never launches a slot.
  const slot = managedOCCdSlot(context, 0, signal)
  await withOCCdActivationLock(
    slot,
    async () => {
      const record = await readOCCdActivationRecord(slot)
      if (!record.active) {
        return
      }
      const stopped = await stopOCCdSlot(slot, occdSlotDir(slot, record.active), false)
      if (occdStopFreedTheHost(stopped)) {
        await writeOCCdActivationRecord(slot, withDeactivatedVersionCommitted(record))
      }
    },
    () => undefined
  )
}
