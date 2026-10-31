import { occdRemoteBaseDir } from '../install/occd-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { OCCdRollbackOptions, OCCdRollbackResult } from '../install/occd-remote-rollback'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import { withRolledBackVersion } from '../activation/occd-activation-record'
import { writeOCCdActivationRecord } from '../activation/occd-activation-record-store'
import { launchAndJudgeOCCdSlot } from '../../ssh/occd-candidate-launch-verdict'
import { assessOCCdRollback } from '../../ssh/occd-update-plan'
import { OCCD_LOG_FILENAME } from '../install/occd-remote-host-support'
import {
  captureOCCdStateSnapshotCommand,
  occdRollbackRescueDirName,
  parseOCCdSnapshotCapture,
  parseOCCdSnapshotPresence,
  parseOCCdSnapshotRestore,
  probeOCCdStateSnapshotCommand,
  restoreOCCdStateSnapshotCommand
} from '../host-state/occd-state-snapshot'
import {
  newestStateMtimeCommand,
  parseNewestStateMtimeSeconds
} from '../host-state/occd-state-newest-mtime'
import { joinRemotePath } from '../../ssh/ssh-remote-platform'
import type { OCCdActivationLockControl } from '../activation/occd-activation-lock'
import {
  rollbackStartingState,
  type OCCdRollbackTransaction
} from '../activation/occd-activation-transaction'
import {
  createOCCdRollbackTransaction,
  withOCCdRollbackPhase,
  withOCCdRollbackRescue
} from '../activation/occd-activation-transaction-transitions'
import { writeOCCdActivationTransaction } from '../activation/occd-activation-transaction-store'
import { ROLLBACK_STALE_COUNT, rollbackRecountRefusal } from './occd-rollback-admission'
import { runFencedStop } from '../../ssh/occd-fenced-stop'
import { execOCCdRemoteOr, withoutAbortSignal } from '../install/occd-remote-runtime-control'
import { execOCCdStateMutationOr } from '../host-state/occd-state-mutation-exec'
import {
  occdSlotDir,
  resolveOCCdSlotIdentity,
  type OCCdSlotIdentity
} from '../../ssh/occd-recovery-slot'
import { occdSnapshotPath } from '../../ssh/occd-incumbent-recovery'
import {
  putTransactionIncumbentBack,
  restoreAfterRejectedCandidate
} from '../../ssh/occd-transaction-incumbent'
import {
  readOCCdRollbackBarrierTarget,
  rollbackBarrierRefusal,
  stopIncumbentBehindTerminalBarrier
} from './occd-rollback-terminal-barrier'
import { withOCCdLogTail } from '../install/occd-remote-log-tail'
import { errorMessage } from '../../../shared/error-message'

async function stateWritesSinceActivation(options: OCCdRollbackOptions): Promise<boolean | null> {
  const activatedAtSeconds = Math.floor(Date.parse(options.record.activatedAt ?? '') / 1000)
  if (!Number.isFinite(activatedAtSeconds)) {
    return null
  }
  const newest = parseNewestStateMtimeSeconds(
    await execOCCdRemoteOr(
      options,
      newestStateMtimeCommand(
        options.host,
        options.userDataDir,
        occdRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  return newest === null ? null : newest >= activatedAtSeconds
}

export async function rollbackOCCdLocked(
  options: OCCdRollbackOptions,
  lock: OCCdActivationLockControl
): Promise<OCCdRollbackResult> {
  const now = options.now ?? ((): Date => new Date())
  const snapshot = options.record.snapshot
  const presence = snapshot
    ? parseOCCdSnapshotPresence(
        await execOCCdRemoteOr(
          options,
          probeOCCdStateSnapshotCommand(
            options.host,
            occdSnapshotPath(options, snapshot.dirName),
            occdRemoteBaseDir(options.host, options.remoteHome)
          )
        )
      )
    : 'absent'
  const safety = assessOCCdRollback({
    record: options.record,
    snapshotPresent: presence === 'unverifiable' ? null : presence === 'present',
    census: options.census,
    targetDaemonProtocol: options.targetDaemonProtocol,
    stateWritesSinceActivation: await stateWritesSinceActivation(options)
  })
  if (safety.safety === 'unsafe') {
    return { outcome: 'refused', code: safety.code, reason: safety.reason }
  }
  if (!snapshot || !options.record.active) {
    return {
      outcome: 'refused',
      code: 'occd_rollback_no_active',
      reason: 'No occd version is active on this host, so there is nothing to roll back from.'
    }
  }
  let incumbent: OCCdSlotIdentity
  try {
    incumbent = await resolveOCCdSlotIdentity(options, options.record.active)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return {
      outcome: 'refused',
      code: 'occd_rollback_active_identity_unverifiable',
      reason: `The active occd identity could not be verified: ${errorMessage(error)} Nothing was changed.`
    }
  }

  const barrierTarget = await readOCCdRollbackBarrierTarget(options, incumbent.version)
  if (barrierTarget.state === 'refused') {
    return { outcome: 'refused', code: barrierTarget.code, reason: barrierTarget.reason }
  }
  const startedAt = now()
  let transaction: OCCdRollbackTransaction = createOCCdRollbackTransaction({
    transactionId: randomUUID(),
    incumbentVersion: incumbent.version,
    targetVersion: safety.target,
    recordBefore: options.record,
    recordAfter: withRolledBackVersion(options.record, startedAt),
    rescueDirName: occdRollbackRescueDirName(incumbent.version, startedAt.getTime()),
    now: startedAt
  })
  const fenced = await runFencedStop({
    recountCensus: options.recountCensus,
    releaseIncumbentAdmission: options.releaseIncumbentAdmission,
    now: () => now().getTime(),
    refuse: rollbackRecountRefusal,
    prepare: () => writeOCCdActivationTransaction(options, transaction),
    stale: () => ROLLBACK_STALE_COUNT,
    stop: async () => {
      lock.retainOnError()
      // Cancellation after mutation could strand a stopped host; finish or recover instead.
      options = withoutAbortSignal(options)
      // Pre-lock census can go stale; the fenced stop supplies the terminal-safety proof.
      return stopIncumbentBehindTerminalBarrier(
        options,
        transaction.transactionId,
        barrierTarget.context
      )
    },
    // Withdrawn stops leave the incumbent serving and needing admission reopened.
    stopMayHaveBeenSent: (barrier) => barrier.state !== 'withdrawn'
  })
  if ('refused' in fenced) {
    return fenced.refused
  }
  const blocked = rollbackBarrierRefusal(fenced.stopped)
  if (blocked) {
    if (blocked.retainFence) {
      lock.retain()
    }
    const recovered = blocked.restartIncumbent
      ? ` ${await putIncumbentBack(options, lock, transaction, incumbent)}`
      : ''
    return { outcome: blocked.outcome, code: blocked.code, reason: blocked.reason + recovered }
  }
  transaction = withOCCdRollbackPhase(transaction, 'incumbent-stopped', now())
  await writeOCCdActivationTransaction(options, transaction)

  const rescue = parseOCCdSnapshotCapture(
    await execOCCdStateMutationOr(
      options,
      captureOCCdStateSnapshotCommand(
        options.host,
        options.userDataDir,
        occdSnapshotPath(options, transaction.rescue.dirName),
        occdRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (rescue === 'failed') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'occd_rollback_rescue_snapshot_failed',
      reason:
        'The current state could not be preserved in a rescue snapshot, so the data root was ' +
        `not replaced. ${recovered}`
    }
  }
  transaction = withOCCdRollbackRescue(transaction, rescue, now())
  await writeOCCdActivationTransaction(options, transaction)

  // Restore before launching: older builds must never load newer state.
  const restored = parseOCCdSnapshotRestore(
    await execOCCdStateMutationOr(
      options,
      restoreOCCdStateSnapshotCommand(
        options.host,
        options.userDataDir,
        occdSnapshotPath(options, snapshot.dirName),
        occdRemoteBaseDir(options.host, options.remoteHome)
      )
    )
  )
  if (restored !== 'restored') {
    const recovered = await putIncumbentBack(options, lock, transaction, incumbent)
    return {
      outcome: 'failed',
      code: 'occd_rollback_restore_failed',
      reason: `The pre-activation snapshot could not be restored (${restored}). ${recovered}`
    }
  }
  transaction = withOCCdRollbackPhase(transaction, 'rollback-state-restored', now())
  await writeOCCdActivationTransaction(options, transaction)

  const targetDir = occdSlotDir(options, safety.target)
  const { verdict, launchError } = await launchAndJudgeOCCdSlot(options, {
    remoteInstallDir: targetDir,
    fullVersion: safety.target,
    buildHash: options.targetBuildHash
  })
  if (verdict.decision === 'reject') {
    const reason =
      launchError === undefined
        ? verdict.reason
        : `It failed while starting: ${errorMessage(launchError)}`
    const recovered = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: targetDir,
      launchedVersion: safety.target,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: rescueVerdict(transaction),
      launchedFromState: rollbackStartingState(transaction)
    })
    return {
      outcome: 'failed',
      code: launchError === undefined ? verdict.code : 'occd_rollback_target_launch_failed',
      reason: await withOCCdLogTail(
        options,
        targetDir,
        `The rollback target ${safety.target} did not come up healthy: ${reason} ${recovered} ` +
          `Its stderr is at ${joinRemotePath(options.host, targetDir, OCCD_LOG_FILENAME)}.`
      )
    }
  }

  // Until target readiness is proven, active must still identify the recoverable incumbent.
  transaction = withOCCdRollbackPhase(transaction, 'target-ready', now())
  await writeOCCdActivationTransaction(options, transaction)
  await writeOCCdActivationRecord(options, transaction.recordAfter)
  return {
    outcome: 'rolled-back',
    target: safety.target,
    discarded: safety.safety === 'lossy' ? safety.discards : [],
    verdict
  }
}

type RestoreState = Parameters<typeof putTransactionIncumbentBack>[2]['restoreState']

function rescueVerdict(transaction: OCCdRollbackTransaction): RestoreState {
  return transaction.rescue.state === 'pending' ? null : transaction.rescue
}

async function putIncumbentBack(
  options: OCCdRollbackOptions,
  lock: OCCdActivationLockControl,
  transaction: OCCdRollbackTransaction,
  incumbent: OCCdSlotIdentity
): Promise<string> {
  const failure = await putTransactionIncumbentBack(options, lock, {
    transactionStartedAt: transaction.startedAt,
    launchedVersion: null,
    incumbent,
    restoreState: rescueVerdict(transaction)
  })
  return failure ?? `occd ${incumbent.version} was restored and is serving again.`
}
