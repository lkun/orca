/** Journal durably before mutation so interrupted deploys can finish or recover. Release the fence only once the host is provably settled on one slot. */
import { occdRemoteBaseDir } from '../managed-server/install/occd-remote-windows-node'
import { randomUUID } from 'node:crypto'
import type { OCCdDeployOptions, OCCdDeployResult } from './occd-remote-deploy'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import {
  withActivatedVersion,
  type OCCdActivationRecord,
  type OCCdStateSnapshot
} from '../managed-server/activation/occd-activation-record'
import {
  readOCCdActivationRecord,
  writeOCCdActivationRecord
} from '../managed-server/activation/occd-activation-record-store'
import { launchAndJudgeOCCdSlot } from './occd-candidate-launch-verdict'
import { planOCCdUpdate } from './occd-update-plan'
import {
  type OCCdTerminalCensus,
  UNVERIFIABLE_OCCD_TERMINAL_CENSUS
} from '../../shared/occd-terminal-census'
import { runFencedStop } from './occd-fenced-stop'
import {
  censusNeedsHostDaemonProtocols,
  CURRENT_OCCD_DAEMON_PROTOCOL
} from './occd-daemon-protocol-crossing'
import { OCCD_LOG_FILENAME } from '../managed-server/install/occd-remote-host-support'
import { occdSnapshotFailureReason } from '../managed-server/host-state/occd-state-snapshot-space'
import {
  OCCD_SNAPSHOT_SPACE_INSUFFICIENT_CODE,
  occdSnapshotRoomRefusal,
  occdSnapshotsRoot
} from './occd-snapshot-room'
import {
  captureOCCdStateSnapshotCommand,
  occdSnapshotDirName,
  parseOCCdSnapshotCapture
} from '../managed-server/host-state/occd-state-snapshot'
import { joinRemotePath } from './ssh-remote-platform'
import { computeLocalOCCdBuildHash } from './occd-local-build-hash'
import { preflightOCCdCandidate } from './occd-candidate-preflight'
import type { OCCdActivationLockControl } from '../managed-server/activation/occd-activation-lock'
import type { OCCdActivateTransaction } from '../managed-server/activation/occd-activation-transaction'
import {
  createOCCdActivationTransaction,
  withOCCdActivationCandidateReady,
  withOCCdActivationIncumbentStopped,
  withOCCdActivationSnapshot
} from '../managed-server/activation/occd-activation-transaction-transitions'
import { writeOCCdActivationTransaction } from '../managed-server/activation/occd-activation-transaction-store'
import {
  execOCCdRemoteOr,
  withoutAbortSignal
} from '../managed-server/install/occd-remote-runtime-control'
import { execOCCdStateMutationOr } from '../managed-server/host-state/occd-state-mutation-exec'
import {
  initialOCCdActivationAdmissionCommand,
  parseInitialOCCdActivationAdmission
} from './occd-initial-activation-admission'
import {
  occdSlotDir,
  resolveOCCdSlotIdentity,
  type OCCdSlotIdentity
} from './occd-recovery-slot'
import { occdSnapshotPath } from './occd-incumbent-recovery'
import {
  restartAfterSnapshotFailure,
  restoreAfterRejectedCandidate,
  stopTransactionIncumbent
} from './occd-transaction-incumbent'
import { withOCCdLogTail } from '../managed-server/install/occd-remote-log-tail'
import { occdCandidateLaunchFailureCode } from '../occd/occd-host-unavailable'
import { errorMessage } from '../../shared/error-message'

type Outcome = Extract<OCCdDeployResult, { outcome: 'installed-not-activated' }>

export const OCCD_ACTIVATION_POLICY_REFUSED_CODE = 'occd_activation_policy_refused'

function countedLockedRecord(options: OCCdDeployOptions, record: OCCdActivationRecord): boolean {
  const counted = options.censusRecord
  return (
    !counted || (counted.active === record.active && counted.activatedAt === record.activatedAt)
  )
}

/** A census of another incumbent cannot authorize stopping this one. */
function censusForLockedRecord(
  options: OCCdDeployOptions,
  record: OCCdActivationRecord
): OCCdTerminalCensus {
  return countedLockedRecord(options, record) ? options.census : UNVERIFIABLE_OCCD_TERMINAL_CENSUS
}

export async function activateInstalledOCCd(
  options: OCCdDeployOptions & { localOCCdDir: string },
  fullVersion: string,
  remoteDir: string,
  lock: OCCdActivationLockControl
): Promise<OCCdDeployResult> {
  const now = options.now ?? ((): Date => new Date())
  const notActivated = (code: string, reason: string): Outcome => ({
    outcome: 'installed-not-activated',
    fullVersion,
    code,
    reason
  })
  const record = await readOCCdActivationRecord(options)
  const planFor = (
    census: OCCdTerminalCensus,
    hostDaemonProtocols?: readonly number[]
  ): ReturnType<typeof planOCCdUpdate> =>
    planOCCdUpdate({
      record,
      candidateVersion: fullVersion,
      census,
      candidateDaemonProtocol: CURRENT_OCCD_DAEMON_PROTOCOL,
      ...(hostDaemonProtocols ? { hostDaemonProtocols } : {}),
      ...(options.force !== undefined ? { force: options.force } : {})
    })
  const census = censusForLockedRecord(options, record)
  let plan = planFor(census)
  if (plan.action === 'noop') {
    return { outcome: 'already-active', fullVersion }
  }
  const refusal = options.admitRecord?.(record, fullVersion)
  if (refusal) {
    return notActivated(OCCD_ACTIVATION_POLICY_REFUSED_CODE, refusal)
  }
  // Hosts predating the census protocol set cannot name mixed generations; the candidate can.
  const asksCandidate = censusNeedsHostDaemonProtocols(census)
  if (
    plan.action === 'defer' &&
    !(asksCandidate && plan.code === 'occd_update_daemon_protocol_unverifiable')
  ) {
    return notActivated(plan.code, plan.reason)
  }
  const preflight = await preflightOCCdCandidate(
    { ...options, remoteInstallDir: remoteDir, fullVersion },
    asksCandidate
  )
  if ('failure' in preflight) {
    return notActivated('occd_candidate_preflight_failed', preflight.failure)
  }
  const { hostDaemonProtocols } = preflight
  plan = planFor(census, hostDaemonProtocols)
  if (plan.action === 'defer') {
    return notActivated(plan.code, plan.reason)
  }

  let incumbent: OCCdSlotIdentity | null = null
  if (record.active) {
    try {
      incumbent = await resolveOCCdSlotIdentity(options, record.active)
    } catch (error) {
      if (isUnconfirmedSshCommandTermination(error)) {
        throw error
      }
      return notActivated(
        'occd_incumbent_identity_unverifiable',
        `The active occd ${record.active} build identity could not be verified before ` +
          `stopping it: ${errorMessage(error)} Nothing was stopped.`
      )
    }
  } else {
    const admission = parseInitialOCCdActivationAdmission(
      await execOCCdRemoteOr(
        options,
        initialOCCdActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    if (admission.decision === 'defer') {
      return notActivated(admission.code, admission.reason)
    }
  }

  // Scan snapshot room before recount so slow scans cannot outdate stop admission.
  const roomless = await occdSnapshotRoomRefusal(options, record, fullVersion)
  if (roomless) {
    return notActivated(OCCD_SNAPSHOT_SPACE_INSUFFICIENT_CODE, roomless)
  }

  const startedAt = now()
  let transaction: OCCdActivateTransaction = createOCCdActivationTransaction({
    transactionId: randomUUID(),
    candidateVersion: fullVersion,
    appVersion: options.appVersion,
    recordBefore: record,
    snapshotDirName: occdSnapshotDirName(fullVersion, startedAt.getTime()),
    now: startedAt
  })
  const beginMutating = (): void => {
    lock.retainOnError()
    // After mutation starts, cancellation would strand a stopped host; finish or roll back.
    options = withoutAbortSignal(options)
  }
  if (incumbent) {
    // Recount immediately before stop; the initial census may predate a long upload.
    const fenced = await runFencedStop({
      recountCensus: () =>
        countedLockedRecord(options, record)
          ? options.recountCensus()
          : Promise.reject(new Error('not the incumbent this update counted')),
      releaseIncumbentAdmission: options.releaseIncumbentAdmission,
      now: () => now().getTime(),
      refuse: (recounted) => {
        const plan = planFor(recounted, hostDaemonProtocols)
        return plan.action === 'defer' ? notActivated(plan.code, plan.reason) : null
      },
      prepare: () => writeOCCdActivationTransaction(options, transaction),
      stale: () =>
        notActivated(
          'occd_update_terminal_census_unavailable',
          'The terminal count went stale before the current server could be stopped, so nothing ' +
            'was stopped. OCC will try the update again.'
        ),
      stop: () => {
        beginMutating()
        return stopTransactionIncumbent(options, incumbent, lock)
      },
      stopMayHaveBeenSent: (unstopped) => unstopped === null || unstopped.stopMayBeUnderway
    })
    if ('refused' in fenced) {
      return fenced.refused
    }
    if (fenced.stopped) {
      return notActivated(
        'occd_outgoing_stop_incomplete',
        `${fenced.stopped.reason} No snapshot was taken and the candidate was not started. OCC ` +
          'requires matching runtime readiness before signaling an incumbent and confirmed exit ' +
          'before snapshotting.'
      )
    }
  } else {
    await writeOCCdActivationTransaction(options, transaction)
    beginMutating()
  }
  transaction = withOCCdActivationIncumbentStopped(transaction, now())
  await writeOCCdActivationTransaction(options, transaction)

  // Wait for confirmed exit before snapshotting; a live SQLite WAL is not a backup boundary.
  const snapshotDir = occdSnapshotPath(options, transaction.snapshot.dirName)
  const captureOutput = await execOCCdStateMutationOr(
    options,
    captureOCCdStateSnapshotCommand(
      options.host,
      options.userDataDir,
      snapshotDir,
      occdRemoteBaseDir(options.host, options.remoteHome),
      {
        snapshotsRoot: occdSnapshotsRoot(options),
        keep: [transaction.snapshot.dirName, ...(record.snapshot ? [record.snapshot.dirName] : [])]
      }
    ),
    'FAILED'
  )
  const capture = parseOCCdSnapshotCapture(captureOutput)
  if (capture === 'failed') {
    const reason = occdSnapshotFailureReason(captureOutput)
    const restarted = incumbent
      ? ` The incumbent was stopped before snapshotting; ${await restartAfterSnapshotFailure(options, incumbent, lock)}`
      : ''
    throw new Error(
      `Could not snapshot ${options.userDataDir} before activating ${fullVersion}` +
        `${reason ? `: ${reason}` : ''}. OCC's persisted state carries no schema version, so ` +
        'without a snapshot a rollback has no way back. Refusing to activate. Fix what stops ' +
        `the copy (often a full disk or quota on ${occdRemoteBaseDir(options.host, options.remoteHome)}), ` +
        `then reconnect.${restarted}`
    )
  }
  const snapshot: OCCdStateSnapshot | null =
    capture === 'captured'
      ? {
          dirName: transaction.snapshot.dirName,
          takenBeforeVersion: fullVersion,
          readableByVersion: record.active,
          takenAt: startedAt.toISOString()
        }
      : null
  transaction = withOCCdActivationSnapshot(transaction, capture, now())
  await writeOCCdActivationTransaction(options, transaction)

  const { verdict, launchError } = await launchAndJudgeOCCdSlot(options, {
    remoteInstallDir: remoteDir,
    fullVersion,
    buildHash: computeLocalOCCdBuildHash(options.localOCCdDir)
  })
  if (verdict.decision === 'reject') {
    const [code, reason] =
      launchError === undefined
        ? [verdict.code, verdict.reason]
        : [
            occdCandidateLaunchFailureCode(launchError),
            `The candidate failed while starting: ${errorMessage(launchError)}`
          ]
    const restored = await restoreAfterRejectedCandidate(options, lock, {
      launchedDir: occdSlotDir(options, transaction.candidateVersion),
      launchedVersion: transaction.candidateVersion,
      transactionStartedAt: transaction.startedAt,
      incumbent,
      restoreState: transaction.snapshot
    })
    const located =
      `${reason} Candidate stderr is at ` +
      `${joinRemotePath(options.host, remoteDir, OCCD_LOG_FILENAME)}. ${restored}`
    return notActivated(code, await withOCCdLogTail(options, remoteDir, located))
  }

  const recordAfter = withActivatedVersion(record, fullVersion, snapshot, now(), options.appVersion)
  transaction = withOCCdActivationCandidateReady(transaction, recordAfter, now())
  await writeOCCdActivationTransaction(options, transaction)
  await writeOCCdActivationRecord(options, recordAfter)
  return { outcome: 'installed-and-activated', fullVersion, verdict }
}
