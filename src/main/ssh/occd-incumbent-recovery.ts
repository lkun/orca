/** Restore changed state only after proven slot exit and operator consent: a launched RPC server may have created terminals the stopped host cannot census, making the snapshot stale. Use the same rule for failure and crash recovery. */
import { execOCCdStateMutation } from '../managed-server/host-state/occd-state-mutation-exec'
import { occdRemoteBaseDir } from '../managed-server/install/occd-remote-windows-node'
import type { ServeReadiness } from '../server/serve-readiness'
import { RELAY_REMOTE_DIR } from './remote-exec/remote-frame-protocol'
import { OCCD_STATE_SNAPSHOT_DIR } from '../managed-server/activation/occd-activation-record'
import type { OCCdSnapshotVerdict } from '../managed-server/activation/occd-activation-transaction'
import {
  clearOCCdStateSnapshotMembersCommand,
  compareOCCdStateSnapshotCommand,
  occdSnapshotIsUnchanged,
  parseOCCdSnapshotRestore,
  restoreOCCdStateSnapshotCommand
} from '../managed-server/host-state/occd-state-snapshot'
import { execOCCdRemote } from '../managed-server/install/occd-remote-runtime-control'
import {
  ensureOCCdSlotServing,
  launchOCCdSlot,
  quiesceInterruptedOCCdSlot,
  type OCCdSlotIdentity,
  type OCCdSlotOptions
} from './occd-recovery-slot'
import { joinRemotePath } from './ssh-remote-platform'
import { OCCD_RECOVERY_CHANGED_STATE_CODE } from '../../shared/occd-managed-runtime'

export type OCCdIncumbentRecoveryOptions = OCCdSlotOptions & {
  /** The operator accepted restoring the snapshot over state a launched build changed. */
  acceptChangedState?: boolean
}

type OCCdIncumbentRecovery =
  | { outcome: 'restored'; readiness: ServeReadiness | null }
  | { outcome: 'refused'; verdict: 'live' | 'unverifiable'; code: string; reason: string }

export function occdSnapshotPath(options: OCCdSlotOptions, dirName: string): string {
  return joinRemotePath(
    options.host,
    options.remoteHome,
    RELAY_REMOTE_DIR,
    OCCD_STATE_SNAPSHOT_DIR,
    dirName
  )
}

/** Unverifiable steps throw so the caller retains the fence. */
export async function recoverOCCdIncumbent(
  options: OCCdIncumbentRecoveryOptions,
  input: {
    transactionStartedAt: string
    launchedVersion: string | null
    incumbent: OCCdSlotIdentity | null
    restoreState: OCCdSnapshotVerdict | null
    /** Rollback may restore a different snapshot from the launched slot's starting state. */
    launchedFromState?: OCCdSnapshotVerdict | null
    /** This run itself proved both slots exited, so no fresh liveness probe is needed. */
    slotsProvenExited?: boolean
  }
): Promise<OCCdIncumbentRecovery> {
  const quiescence =
    input.slotsProvenExited || !input.restoreState
      ? 'exited'
      : await quiesceInterruptedOCCdSlot(options, input.launchedVersion, input.incumbent)
  // With no incumbent there is no older reader to protect; the record names nothing to serve.
  if (quiescence === 'exited' && input.restoreState && input.incumbent) {
    const decision = input.launchedVersion
      ? await decideChangedStateRestore(options, input.launchedFromState ?? input.restoreState)
      : 'restore'
    if (decision !== 'restore' && decision !== 'unchanged') {
      return decision
    }
    // A launched slot that left its starting state untouched still sits on a root to replace.
    if (decision === 'restore' || input.launchedFromState) {
      await restoreState(options, input.restoreState)
    }
  }
  if (!input.incumbent) {
    return { outcome: 'restored', readiness: null }
  }
  return {
    outcome: 'restored',
    readiness: input.slotsProvenExited
      ? await launchOCCdSlot(options, input.incumbent)
      : await ensureOCCdSlotServing(options, input.incumbent)
  }
}

async function decideChangedStateRestore(
  options: OCCdIncumbentRecoveryOptions,
  state: OCCdSnapshotVerdict
): Promise<'unchanged' | 'restore' | Extract<OCCdIncumbentRecovery, { outcome: 'refused' }>> {
  if (state.state === 'captured') {
    const snapshotDir = occdSnapshotPath(options, state.dirName)
    // A lost read-only comparison can conservatively mean changed.
    const comparison = await execOCCdRemote(
      options,
      compareOCCdStateSnapshotCommand(
        options.host,
        options.userDataDir,
        snapshotDir,
        occdRemoteBaseDir(options.host, options.remoteHome)
      )
    ).catch(() => '')
    if (occdSnapshotIsUnchanged(comparison)) {
      return 'unchanged'
    }
  }
  if (options.acceptChangedState) {
    return 'restore'
  }
  const retained =
    state.state === 'captured' ? ` at ${occdSnapshotPath(options, state.dirName)}` : ''
  return {
    outcome: 'refused',
    verdict: 'unverifiable',
    code: OCCD_RECOVERY_CHANGED_STATE_CODE,
    reason:
      'The launched build is stopped, but it changed profile state (or the change could not be ' +
      'checked), so the previous build was not restarted against it and this host serves ' +
      'nothing. Recover to restore the prelaunch snapshot' +
      `${retained} and restart the previous build; terminals the launched build started keep ` +
      'running but drop out of the restored state.'
  }
}

async function restoreState(options: OCCdSlotOptions, state: OCCdSnapshotVerdict): Promise<void> {
  if (state.state === 'pending') {
    throw new Error('The interrupted transaction has no durable snapshot verdict.')
  }
  const command =
    state.state === 'captured'
      ? restoreOCCdStateSnapshotCommand(
          options.host,
          options.userDataDir,
          occdSnapshotPath(options, state.dirName),
          occdRemoteBaseDir(options.host, options.remoteHome)
        )
      : clearOCCdStateSnapshotMembersCommand(
          options.host,
          options.userDataDir,
          occdRemoteBaseDir(options.host, options.remoteHome)
        )
  const restored = parseOCCdSnapshotRestore(await execOCCdStateMutation(options, command))
  if (restored !== 'restored') {
    throw new Error(`The prelaunch state could not be restored (${restored}).`)
  }
}
