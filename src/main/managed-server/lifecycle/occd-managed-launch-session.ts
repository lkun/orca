import { randomUUID } from 'node:crypto'
import type { OCCdManagedRestartResult } from '../../../shared/occd-managed-runtime'
import {
  withOCCdActivationLock,
  type OCCdActivationLockControl
} from '../activation/occd-activation-lock'
import { readOCCdActivationRecord } from '../activation/occd-activation-record-store'
import {
  occdLaunchSshSessionProbeCommand,
  parseOCCdLaunchSshSession,
  recordsOCCdLaunchSshSession,
  type OCCdLaunchSshSession
} from '../../ssh/occd-launch-ssh-session'
import { withManagedOCCdLifecycle } from '../../ssh/occd-runtime-maintenance'
import {
  managedOCCdInstallDir,
  managedOCCdSlot,
  requireManagedOCCdEnvironment,
  requireManagedOCCdInfrastructure,
  resolveLinkedOCCdContext
} from './occd-managed-runtime-context'
import { resolveOCCdRemoteContext } from '../install/occd-remote-context'
import { sshOCCdHostTransport } from '../../ssh/occd-ssh-host-transport'
import { rebuildOCCdManagedTunnel } from './occd-managed-tunnel'
import { wakeStoppedManagedOCCd } from './occd-managed-wake'
import { readRemoteOCCdManagedStopTarget } from './occd-managed-remote-stop'
import { occdSlotDir, type OCCdSlotOptions } from '../../ssh/occd-recovery-slot'
import { stopIncumbentBehindTerminalBarrier } from './occd-rollback-terminal-barrier'
import { execOCCdRemote } from '../install/occd-remote-runtime-control'
import { collectManagedTerminalCensus } from '../../ssh/occd-terminal-census-client'
import { runFencedStop, updateTerminalCounts } from '../../ssh/occd-fenced-stop'

export async function readManagedOCCdLaunchSshSession(
  userDataPath: string,
  environmentId: string
): Promise<OCCdLaunchSshSession> {
  const { deployment } = requireManagedOCCdEnvironment(userDataPath, environmentId)
  const { connectionManager, targetStore } = requireManagedOCCdInfrastructure()
  const target = targetStore.getTarget(deployment.sshTargetId)
  // Background checks must not reconnect hosts the user left.
  const connection =
    target && connectionManager.getState(target.id)?.status === 'connected'
      ? (connectionManager.getConnection(target.id) ?? null)
      : null
  if (!target || !connection) {
    return 'unverifiable'
  }
  const context = await resolveOCCdRemoteContext(target, sshOCCdHostTransport(connection))
  if (!recordsOCCdLaunchSshSession(context.host)) {
    return 'not-applicable'
  }
  const active = context.activationRecord.active
  if (!active) {
    return 'not-recorded'
  }
  return parseOCCdLaunchSshSession(
    await execOCCdRemote(
      { conn: context.connection, host: context.host },
      occdLaunchSshSessionProbeCommand(
        context.host,
        managedOCCdInstallDir(context, active),
        context.userDataDir
      )
    )
  )
}

/** Restart only without terminals: surviving daemons retain the old SSH-session attribution. */
export function restartManagedOCCdEnvironment(
  userDataPath: string,
  selector: string
): Promise<OCCdManagedRestartResult> {
  return withManagedOCCdLifecycle(userDataPath, selector, async ({ environment, deployment }) => {
    const context = await resolveLinkedOCCdContext(environment, deployment)
    if (!context.activationRecord.active) {
      return { outcome: 'not-restarted', reason: 'This host has no activated OCC server.' }
    }
    const counts = updateTerminalCounts((options) =>
      collectManagedTerminalCensus(
        userDataPath,
        environment,
        context.activationRecord,
        undefined,
        options
      )
    )
    // Reject live terminals before waiting for the host lock.
    const census = await counts.countFirst()
    if (census.liveSessions !== 0) {
      return { outcome: 'terminals-running', liveSessions: census.liveSessions }
    }
    const slot = managedOCCdSlot(context, deployment.remotePort)
    const stopped = await withOCCdActivationLock(
      slot,
      (lock) => recountThenStop(slot, lock, counts),
      (): StopOutcome => ({
        state: 'kept',
        reason: 'An update, rollback or recovery holds this host; try again when it finishes.'
      })
    )
    if (stopped.state === 'terminals-running') {
      return { outcome: 'terminals-running', liveSessions: stopped.liveSessions }
    }
    if (stopped.state === 'kept') {
      return { outcome: 'not-restarted', reason: stopped.reason }
    }
    // Wake even when daemon retirement failed: the stopped server cannot serve clients.
    const wake = await wakeStoppedManagedOCCd(slot)
    if (wake.outcome !== 'started' && wake.outcome !== 'serving') {
      return {
        outcome: 'not-restarted',
        reason:
          wake.outcome === 'recovery-refused'
            ? wake.reason
            : `This host’s OCC server stopped but did not start again (${wake.outcome}); reconnect to start it.`
      }
    }
    // Restart may bind a different port than the existing forward.
    await rebuildOCCdManagedTunnel(userDataPath, environment.id)
    const dir = occdSlotDir(slot, stopped.version)
    if (stopped.state === 'daemon-kept') {
      // A retained daemon keeps old attribution, so preserve the warning.
      return { outcome: 'not-restarted', reason: stopped.reason }
    }
    const session = parseOCCdLaunchSshSession(
      await execOCCdRemote(
        slot,
        occdLaunchSshSessionProbeCommand(slot.host, dir, slot.userDataDir)
      )
    )
    if (session === 'exited') {
      return {
        outcome: 'not-restarted',
        reason:
          'This host’s OCC server restarted, but its terminals still belong to an SSH session ' +
          'that has ended: its terminal daemon was still running, or this connection opens a ' +
          'new SSH session for each command. Turn on SSH connection reuse for this host if ' +
          'it is off, then restart again.'
      }
    }
    return { outcome: 'restarted', environmentId: environment.id }
  })
}

type StopOutcome =
  | { state: 'retired'; version: string }
  /** The surviving daemon still spawns terminals with old attribution. */
  | { state: 'daemon-kept'; version: string; reason: string }
  /** Serving or possibly stopping; do not start another instance. */
  | { state: 'kept'; reason: string; mayBeStopping?: true }
  | { state: 'terminals-running'; liveSessions: number | null }

/** Only the host lock holder may close/reopen admission, preserving other runs' fences. */
async function recountThenStop(
  slot: OCCdSlotOptions,
  lock: OCCdActivationLockControl,
  counts: ReturnType<typeof updateTerminalCounts>
): Promise<StopOutcome> {
  const fenced = await runFencedStop({
    ...counts,
    now: Date.now,
    refuse: (census): StopOutcome | null =>
      census.liveSessions === 0
        ? null
        : { state: 'terminals-running', liveSessions: census.liveSessions },
    stale: (): StopOutcome => STALE_COUNT,
    stop: (stillFenced) => stopRetiringIdleDaemon(slot, lock, stillFenced),
    // Woken servers start with admission open; only unsent stops need reopening.
    stopMayHaveBeenSent: (outcome) =>
      outcome.state === 'retired' ||
      outcome.state === 'daemon-kept' ||
      (outcome.state === 'kept' && outcome.mayBeStopping === true)
  })
  return 'refused' in fenced ? fenced.refused : fenced.stopped
}

const STALE_COUNT: StopOutcome = {
  state: 'kept',
  reason: 'The terminal count went stale before the stop. Restart again.'
}

async function stopRetiringIdleDaemon(
  slot: OCCdSlotOptions,
  lock: OCCdActivationLockControl,
  stillFenced: () => boolean
): Promise<StopOutcome> {
  // Other clients may change the active slot; reread under the fence.
  const active = (await readOCCdActivationRecord(slot)).active
  if (!active) {
    return { state: 'kept', reason: 'This host has no activated OCC server.' }
  }
  const target = await readRemoteOCCdManagedStopTarget(slot, active)
  if (target.state === 'refused') {
    return { state: 'kept', reason: target.reason }
  }
  // Expired census fences may have admitted terminals; do not stop after expiry.
  if (!stillFenced()) {
    return STALE_COUNT
  }
  const barrier = await stopIncumbentBehindTerminalBarrier(slot, randomUUID(), target.context)
  switch (barrier.state) {
    case 'retired':
      return { state: 'retired', version: active }
    case 'unproven':
      return {
        state: 'daemon-kept',
        version: active,
        reason:
          'This host’s OCC server restarted, but its terminal daemon kept running because a terminal ' +
          'was open at the stop, so terminals may still lack local network access.'
      }
    case 'unsettled':
      // Recovery must retain the fence while occd may still be stopping.
      lock.retain()
      return { state: 'kept', reason: barrier.reason, mayBeStopping: true }
    case 'withdrawn':
      return { state: 'kept', reason: barrier.reason }
  }
}
