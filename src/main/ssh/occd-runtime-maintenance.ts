/** Census through the managed tunnel before lifecycle changes. Unknown counts never mean zero, so live/uncounted hosts defer update (D7). */
import { getAppEnvironment } from '../../shared/app-environment'
import { assertRuntimeEnvironmentNotReconciling } from '../../shared/remote-runtime/host-catalog/runtime-environment-reconciliation-record'
import {
  redactRuntimeEnvironment,
  type KnownRuntimeEnvironment
} from '../../shared/remote-runtime/host-catalog/runtime-environments'
import type {
  OCCdManagedDeployResult,
  OCCdManagedPastLiveTerminals,
  OCCdManagedRecoveryResult,
  OCCdManagedRollbackResult
} from '../../shared/occd-managed-runtime'
import { runTargetLifecycle } from '../ipc/ssh/ssh-target-lifecycle-queue'
import { recoverInterruptedOCCdActivation } from '../managed-server/activation/occd-activation-recovery'
import { probeActiveOCCdReadiness } from './occd-active-readiness'
import { materializeOCCdArtifact } from '../occd/occd-artifact-materializer'
import { CURRENT_OCCD_DAEMON_PROTOCOL } from './occd-daemon-protocol-crossing'
import { rebuildOCCdManagedTunnel } from '../managed-server/lifecycle/occd-managed-tunnel'
import { wakeAlreadyActiveOCCd } from './occd-already-active-wake'
import {
  clearManagedOCCdUpdateDeferral,
  recordManagedOCCdUpdateDeferral
} from '../managed-server/lifecycle/occd-managed-update-deferrals'
import {
  isForceableOCCdDeferral,
  managedOCCdInstallDir,
  managedOCCdSlot,
  probeManagedOCCdReadiness,
  requireManagedOCCdEnvironment,
  resolveLinkedOCCdContext
} from '../managed-server/lifecycle/occd-managed-runtime-context'
import type { OCCdRemoteContext } from '../managed-server/install/occd-remote-context'
import { readRemoteOCCdBuildHash } from '../managed-server/install/occd-remote-build-hash'
import { deployOCCd, type OCCdDeployOptions } from './occd-remote-deploy'
import type { OCCdUpdateForce } from './occd-update-plan'
import { OCCD_ACTIVATION_POLICY_REFUSED_CODE } from './occd-installed-activation'
import {
  pruneManagedOCCdVersions,
  pruneSupersededOCCdCandidates
} from '../managed-server/lifecycle/occd-managed-version-gc'
import { clearOCCdUpdateFailedThisLaunch } from '../managed-server/lifecycle/occd-managed-update-failure-memory'
import { admitOCCdRecordForIntent } from '../managed-server/lifecycle/occd-managed-update-decision'
import { rollbackOCCd } from '../managed-server/install/occd-remote-rollback'
import { collectManagedTerminalCensus } from './occd-terminal-census-client'
import { updateTerminalCounts } from './occd-fenced-stop'
import { findIncompleteManagedOCCdMigration } from '../managed-server/lifecycle/occd-managed-migration-status'
import { latestOCCdMigrationInto } from './occd-migration-rollback-mark'
import { refreshMaintainedOCCdPairing } from './occd-maintenance-pairing-refresh'

type LifecycleArgs = { selector: string; signal?: AbortSignal }

export function withManagedOCCdLifecycle<T>(
  userDataPath: string,
  selector: string,
  run: (managed: ReturnType<typeof requireManagedOCCdEnvironment>) => Promise<T>
): Promise<T> {
  const { environment, deployment } = requireManagedOCCdEnvironment(userDataPath, selector)
  return runTargetLifecycle(deployment.sshTargetId, async () => {
    // Re-read in the lifecycle queue because reconciliation/stop may have won first.
    const current = requireManagedOCCdEnvironment(userDataPath, environment.id)
    assertRuntimeEnvironmentNotReconciling(current.environment)
    return run(current)
  })
}

/** Rebuild forwarding when a launched slot binds a different port. */
export async function followLaunchedServerPort(
  userDataPath: string,
  environmentId: string
): Promise<void> {
  try {
    await rebuildOCCdManagedTunnel(userDataPath, environmentId)
  } catch (error) {
    // Server already launched; if tunnel rebuild fails, the next connect can forward its bound port.
    console.warn('[ssh] Could not forward to the relaunched managed OCC server:', error)
  }
}

export function updateManagedOCCdEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { force?: boolean; pastLiveTerminals?: OCCdManagedPastLiveTerminals }
): Promise<OCCdManagedDeployResult> {
  const { pastLiveTerminals } = args
  // Update anyway keeps Update's version admission even if a caller also passed force.
  const intent = args.force && !pastLiveTerminals ? 'force' : 'update'
  return withManagedOCCdLifecycle(userDataPath, args.selector, async (managed) => {
    const admitIntent = admitOCCdRecordForIntent(intent, getAppEnvironment().getVersion())
    // Checked under the host fence: another desktop may have activated a build since the confirm.
    const admitRecord: NonNullable<OCCdDeployOptions['admitRecord']> = pastLiveTerminals
      ? (record, candidateVersion) =>
          record.active !== pastLiveTerminals.incumbentVersion
            ? "This host's server changed since the update was confirmed. Review it and update again."
            : admitIntent(record, candidateVersion)
      : admitIntent
    const force: OCCdUpdateForce | undefined = pastLiveTerminals ? 'live-terminals' : args.force
    const result = await runManagedOCCdUpdate(
      userDataPath,
      managed,
      await resolveLinkedOCCdContext(managed.environment, managed.deployment, args.signal),
      { signal: args.signal, force, admitRecord }
    )
    // A completed manual update clears automatic failure suppression; deferred attempts do not.
    if (result.outcome !== 'deferred') {
      clearOCCdUpdateFailedThisLaunch({ kind: 'ssh', id: managed.deployment.sshTargetId })
    }
    return result
  })
}

export async function runManagedOCCdUpdate(
  userDataPath: string,
  { environment, deployment }: ReturnType<typeof requireManagedOCCdEnvironment>,
  context: OCCdRemoteContext,
  args: {
    force?: OCCdUpdateForce
    signal?: AbortSignal
    localOCCdDir?: string
    admitRecord?: OCCdDeployOptions['admitRecord']
  }
): Promise<OCCdManagedDeployResult> {
  const { countFirst, ...recount } = updateTerminalCounts((options) =>
    collectManagedTerminalCensus(
      userDataPath,
      environment,
      context.activationRecord,
      undefined,
      options
    )
  )
  const census = await countFirst()
  const localOCCdDir =
    args.localOCCdDir ??
    (await materializeOCCdArtifact(context.serverTarget, { signal: args.signal }))
  const slot = managedOCCdSlot(context, deployment.remotePort, args.signal)
  const result = await deployOCCd({
    ...slot,
    localOCCdDir,
    target: context.serverTarget,
    census,
    ...recount,
    censusRecord: context.activationRecord,
    force: args.force,
    appVersion: getAppEnvironment().getVersion(),
    ...(args.admitRecord ? { admitRecord: args.admitRecord } : {})
  })
  if (result.outcome === 'installed-not-activated') {
    const deferral = {
      outcome: 'deferred' as const,
      candidateVersion: result.fullVersion,
      code: result.code,
      reason: result.reason,
      // Force may override policy deferrals, including a newer host build.
      forceable:
        isForceableOCCdDeferral(result.code) ||
        result.code === OCCD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Policy refusal is final for this host, not a transient update to retry.
    if (result.code !== OCCD_ACTIVATION_POLICY_REFUSED_CODE) {
      recordManagedOCCdUpdateDeferral(environment.id, deferral, context.activationRecord)
    }
    await pruneSupersededOCCdCandidates(slot, context.serverTarget, result.fullVersion)
    return deferral
  }
  clearManagedOCCdUpdateDeferral(environment.id)
  const alreadyActive = result.outcome === 'already-active'
  const managed = { environmentId: environment.id, hostLabel: context.target.label }
  const started = alreadyActive && (await wakeAlreadyActiveOCCd(slot, managed))
  const readiness = await probeManagedOCCdReadiness(
    context,
    localOCCdDir,
    result.fullVersion,
    args.signal
  )
  await pruneManagedOCCdVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: result.fullVersion,
    readiness
  })
  const updated = refreshMaintainedOCCdPairing(userDataPath, environment.id, readiness)
  if (started || result.outcome !== 'already-active') {
    await followLaunchedServerPort(userDataPath, environment.id)
  }
  return {
    outcome: result.outcome === 'already-active' ? 'already-current' : 'updated',
    environment: redactRuntimeEnvironment(updated),
    activeVersion: result.fullVersion
  }
}

export function rollbackManagedOCCdEnvironment(
  userDataPath: string,
  args: LifecycleArgs
): Promise<OCCdManagedRollbackResult> {
  return withManagedOCCdLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedOCCdContext(environment, deployment, args.signal)
      const record = context.activationRecord
      const target = record.previous
      if (!target) {
        return {
          outcome: 'refused',
          code: 'occd_rollback_no_target',
          reason: 'This server has no previous version to roll back to.'
        }
      }
      const crossing = migrationRollbackRefusal(userDataPath, environment, record.activatedAt)
      if (crossing) {
        return crossing
      }
      const slot = managedOCCdSlot(context, deployment.remotePort, args.signal)
      const targetDir = managedOCCdInstallDir(context, target)
      const targetBuildHash = await readRemoteOCCdBuildHash(slot, targetDir)
      const { countFirst, ...recount } = updateTerminalCounts((options) =>
        collectManagedTerminalCensus(userDataPath, environment, record, undefined, options)
      )
      // Recount under lock before rollback stop; this initial census closes no admission.
      const census = await countFirst()
      // Require idle because this client cannot prove the older build's daemon protocol attaches to live terminals.
      if (census.liveSessions !== 0) {
        return {
          outcome: 'refused',
          code:
            census.liveSessions === null
              ? 'occd_rollback_census_unavailable'
              : 'occd_rollback_terminals_running',
          reason:
            census.liveSessions === null
              ? 'The server did not answer how many terminals it runs. Retry when it answers.'
              : 'Close the terminals running on this server before rolling it back.'
        }
      }
      const result = await rollbackOCCd({
        ...slot,
        record,
        census,
        ...recount,
        targetBuildHash,
        targetDaemonProtocol: CURRENT_OCCD_DAEMON_PROTOCOL
      })
      if (result.outcome !== 'rolled-back') {
        return result
      }
      const readiness = await probeActiveOCCdReadiness(
        { ...slot, remoteInstallDir: targetDir },
        { buildHash: targetBuildHash, fullVersion: result.target }
      )
      const updated = refreshMaintainedOCCdPairing(userDataPath, environment.id, readiness)
      await followLaunchedServerPort(userDataPath, environment.id)
      return {
        outcome: 'rolled-back',
        environment: redactRuntimeEnvironment(updated),
        activeVersion: result.target,
        discarded: result.discarded
      }
    }
  )
}

export function recoverManagedOCCdEnvironment(
  userDataPath: string,
  args: LifecycleArgs & { acceptChangedState?: boolean }
): Promise<OCCdManagedRecoveryResult> {
  return withManagedOCCdLifecycle(
    userDataPath,
    args.selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedOCCdContext(environment, deployment, args.signal)
      const result = await recoverInterruptedOCCdActivation({
        ...managedOCCdSlot(context, deployment.remotePort, args.signal),
        acceptChangedState: args.acceptChangedState === true
      })
      if (result.outcome !== 'recovered') {
        return result
      }
      const updated = result.readiness
        ? refreshMaintainedOCCdPairing(userDataPath, environment.id, result.readiness)
        : environment
      if (result.activeVersion) {
        await followLaunchedServerPort(userDataPath, environment.id)
      }
      return {
        outcome: 'recovered',
        resolution: result.resolution,
        activeVersion: result.activeVersion,
        environment: redactRuntimeEnvironment(updated)
      }
    }
  )
}

/** A post-activation migration is absent from the rollback snapshot; restoring it would discard imported state. */
function migrationRollbackRefusal(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  activatedAt: string | null
): OCCdManagedRollbackResult | null {
  if (findIncompleteManagedOCCdMigration(userDataPath, environment.id)) {
    return {
      outcome: 'refused',
      code: 'occd_rollback_migration_in_progress',
      reason: 'A migration into this server is still running. Finish it before rolling back.'
    }
  }
  const migratedAt = latestOCCdMigrationInto(userDataPath, environment)
  if (migratedAt && (activatedAt === null || Date.parse(activatedAt) < Date.parse(migratedAt))) {
    return {
      outcome: 'refused',
      code: 'occd_rollback_crosses_migration',
      reason:
        "The previous version's state predates the projects migrated onto this server; " +
        'rolling back would lose them. Deploy forward instead.'
    }
  }
  return null
}
