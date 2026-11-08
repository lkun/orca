/** A slot this connect uploaded whose candidate then failed its start check is deleted, so the next connect re-uploads it instead of relaunching the same broken bytes. */
import { readOCCdActivationRecord } from '../../managed-server/activation/occd-activation-record-store'
import { occdGcPinnedDirNames } from '../../managed-server/activation/occd-activation-record'
import {
  probeOCCdSlotReadiness,
  provenLiveDaemonVersion
} from '../../managed-server/lifecycle/occd-managed-version-gc'
import { withOCCdActivationLock } from '../../managed-server/activation/occd-activation-lock'
import { removeRemoteInstallVersionDir } from '../../managed-server/install/remote-install-gc'
import {
  OCCD_INSTALL_MODEL,
  remoteInstallDirName
} from '../../managed-server/install/remote-install-model'
import { readOCCdGcTransactionPins } from '../../ssh/occd-gc-transaction-pins'
import { occdSlotDir, type OCCdSlotOptions } from '../../ssh/occd-recovery-slot'
import type { OCCdDeployResult } from '../../ssh/occd-remote-deploy'
import { isWslOCCdSlotInUse } from './wsl-occd-slot-process-probe'

export async function removeFailedFreshWslOCCdInstall(
  slot: OCCdSlotOptions,
  deployed: OCCdDeployResult
): Promise<void> {
  if (
    deployed.outcome !== 'installed-not-activated' ||
    !deployed.startCheckFailed ||
    !deployed.freshlyInstalled
  ) {
    return
  }
  const version = deployed.fullVersion
  try {
    // Under the activation fence, so no activator can preflight or launch this slot meanwhile.
    const outcome = await withOCCdActivationLock(
      slot,
      async () => {
        if (!(await mayRemove(slot, version))) {
          return 'pinned'
        }
        const removed = await removeRemoteInstallVersionDir(
          slot.conn,
          OCCD_INSTALL_MODEL,
          occdSlotDir(slot, version),
          slot.host,
          { isDirLive: (dir) => isWslOCCdSlotInUse(slot, dir) }
        )
        return removed ? 'removed' : 'in-use'
      },
      () => 'fenced'
    )
    console.warn(
      outcome === 'removed'
        ? `[wsl-occd] Removed occd ${version}, which failed its start check after install.`
        : `[wsl-occd] Kept failed occd ${version} (${outcome}): it may still be in use.`
    )
  } catch (error) {
    // The connect already failed; a cleanup error must not replace its reason.
    console.warn(`[wsl-occd] Could not remove failed occd ${version}:`, error)
  }
}

/** The GC's pins: active, rollback target, the active daemon's build and any journaled slot. */
async function mayRemove(slot: OCCdSlotOptions, version: string): Promise<boolean> {
  const dirName = remoteInstallDirName(OCCD_INSTALL_MODEL, version)
  const record = await readOCCdActivationRecord(slot)
  // Nothing active serves terminals; a daemon the rejected candidate left here is caught by the process probe.
  const liveDaemonVersion = record.active
    ? provenLiveDaemonVersion(await probeOCCdSlotReadiness(slot, record.active))
    : null
  if (liveDaemonVersion === undefined) {
    return false
  }
  if (occdGcPinnedDirNames(record, liveDaemonVersion).includes(dirName)) {
    return false
  }
  const transaction = await readOCCdGcTransactionPins(slot, { callerHoldsFence: true })
  return transaction.state === 'pinned' && !transaction.dirNames.includes(dirName)
}
