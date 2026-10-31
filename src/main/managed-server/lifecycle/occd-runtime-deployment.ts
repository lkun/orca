// Target claims preserve environment identity so interrupted deploys resume the same registration.
import { getAppEnvironment } from '../../../shared/app-environment'
import { randomUUID } from 'node:crypto'
import { assertRuntimeEnvironmentNotReconciling } from '../../../shared/runtime-environment-reconciliation-record'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import { addManagedOCCdEnvironment } from '../../../shared/runtime-environment-managed-occd-store'
import {
  getOCCdSshDeployment,
  redactRuntimeEnvironment
} from '../../../shared/runtime-environments'
import {
  OCCD_MANAGED_REMOTE_PORT,
  type OCCdManagedDeferral,
  type OCCdManagedDeployResult
} from '../../../shared/occd-managed-runtime'
import { getManagedOCCdFenceEnvironmentId } from '../../../shared/managed-occd-ssh-owner'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import { materializeOCCdArtifact } from '../../occd/occd-artifact-materializer'
import {
  closeOCCdManagedTunnel,
  ensureOCCdManagedTunnel,
  startOCCdManagedTunnel
} from './occd-managed-tunnel'
import { recoverInterruptedOCCdActivation } from '../activation/occd-activation-recovery'
import { wakeAlreadyActiveOCCd } from '../../ssh/occd-already-active-wake'
import { readOCCdActivationRecord } from '../activation/occd-activation-record-store'
import { resolveOCCdRemoteContext, type OCCdRemoteContext } from '../install/occd-remote-context'
import { deployOCCd } from '../../ssh/occd-remote-deploy'
import {
  adoptRunningOCCdVersion,
  type OCCdRunningAdoption
} from '../../ssh/occd-running-version-adoption'
import { readLocalFullVersion } from '../install/remote-versioned-install'
import { sshOCCdHostTransport } from '../../ssh/occd-ssh-host-transport'
import { OCCD_ACTIVATION_POLICY_REFUSED_CODE } from '../../ssh/occd-installed-activation'
import { pruneManagedOCCdVersions } from './occd-managed-version-gc'
import { tunneledOCCdPairingCode } from '../../ssh/occd-tunneled-pairing'
import { resolveOCCdMigrationFence } from '../../ssh/occd-migration-source-fence'
import type { SshTarget } from '../../../shared/ssh-types'
import { findCollidingEnvironmentName } from '../../../shared/runtime-environment-name-collision'
import { deployedOCCdTunnelChecks } from './occd-managed-tunnel-identity'
import {
  isForceableOCCdDeferral,
  managedOCCdDeployPolicy,
  managedOCCdSlot,
  probeManagedOCCdReadiness,
  requireManagedOCCdInfrastructure
} from './occd-managed-runtime-context'

export async function createManagedOCCdEnvironment(
  userDataPath: string,
  args: {
    name: string
    sshTargetId: string
    force?: boolean
    signal?: AbortSignal
    migration?: boolean
  }
): Promise<OCCdManagedDeployResult> {
  return runTargetLifecycle(args.sshTargetId, async () => {
    const { connectionManager, targetStore, claims } = requireManagedOCCdInfrastructure()
    const environmentId =
      getManagedOCCdFenceEnvironmentId(targetStore.getTarget(args.sshTargetId)) ?? randomUUID()
    // Duplicate/name checks before an add: a crash-zeroed list (#18766) must read as empty here.
    const environments = listEnvironments(userDataPath, { recoverBlankStore: true })
    const registered = environments.find((entry) => entry.id === environmentId)
    if (registered) {
      assertRuntimeEnvironmentNotReconciling(registered)
      if (getOCCdSshDeployment(registered)?.sshTargetId !== args.sshTargetId) {
        throw new Error('The SSH target is owned by a server that is not deployed on it.')
      }
    }
    const namesake = findCollidingEnvironmentName(
      environments.filter((entry) => entry.id !== environmentId),
      args.name
    )
    if (namesake) {
      throw new Error(`A server named "${namesake.name}" already exists.`)
    }
    const current = targetStore.getTarget(args.sshTargetId)
    if (args.migration) {
      assertMigrationFence(userDataPath, current, environmentId, args.name)
    }
    const claimed = claims.claim(args.sshTargetId, environmentId, {
      ...(args.migration ? {} : { deployName: args.name }),
      ownerRecorded:
        Boolean(args.migration) || Boolean(current?.occdProvisioning) || Boolean(registered)
    })
    await claims.flush(args.signal)
    const targetGeneration = claimed.generation
    if (targetGeneration === undefined) {
      throw new Error('The SSH registration for this host’s OCC server has no durable generation.')
    }
    if (registered && getOCCdSshDeployment(registered)?.sshTargetGeneration !== targetGeneration) {
      throw new Error('The saved OCC server for this host has a stale SSH target generation.')
    }
    let environmentRegistered = false
    try {
      const connection = await connectionManager.connect(claimed)
      let context = await resolveOCCdRemoteContext(
        claimed,
        sshOCCdHostTransport(connection),
        args.signal
      )
      const slot = managedOCCdSlot(context, OCCD_MANAGED_REMOTE_PORT, args.signal)
      const recovery = await recoverInterruptedOCCdActivation(slot)
      if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
        throw new Error(recovery.reason)
      }
      if (recovery.outcome === 'recovered') {
        context = { ...context, activationRecord: await readOCCdActivationRecord(slot) }
      }
      if (registered) {
        environmentRegistered = true
        const current = await ensureOCCdManagedTunnel(userDataPath, registered.id)
        const activeVersion = context.activationRecord.active
        if (!activeVersion) {
          throw new Error('This host’s OCC server has no active runtime version.')
        }
        return {
          outcome: 'already-current',
          environment: redactRuntimeEnvironment(current),
          activeVersion
        }
      }
      const localOCCdDir = await materializeOCCdArtifact(context.serverTarget, {
        signal: args.signal
      })
      // Adopt before upload: only the paired incumbent can count terminals; redeploy would defer.
      const localVersion = readLocalFullVersion(localOCCdDir)
      const adopted = args.force
        ? null
        : await adoptRunningOCCdVersion(slot, context.activationRecord, localVersion)
      const { active } = context.activationRecord
      if (!adopted && !args.force && active && active !== localVersion) {
        // Wake may observe a peer's changed record; census admission must use that same record.
        context = { ...context, activationRecord: await readOCCdActivationRecord(slot) }
      }
      const serving: DeployedOCCd | OCCdManagedDeferral =
        adopted ??
        (await deployOwnOCCd(context, { ...slot, conn: connection }, localOCCdDir, args))
      if ('outcome' in serving) {
        return serving
      }
      // Read the bound port: the preferred port may belong to another host process.
      const tunnel = deployedOCCdTunnelChecks(serving.readiness, serving.reprobe)
      const localPort = await startOCCdManagedTunnel(
        environmentId,
        claimed,
        connection,
        tunnel.remotePort,
        { ...tunnel, preferredPort: OCCD_MANAGED_REMOTE_PORT }
      )
      const environment = addManagedOCCdEnvironment(userDataPath, {
        id: environmentId,
        name: args.name,
        pairingCode: tunneledOCCdPairingCode(tunnel.readiness(), localPort),
        occdDeployment: {
          sshTargetId: claimed.id,
          sshTargetGeneration: targetGeneration,
          localPort,
          remotePort: OCCD_MANAGED_REMOTE_PORT
        }
      })
      environmentRegistered = true
      return {
        outcome: serving.created ? 'created' : 'already-current',
        environment: redactRuntimeEnvironment(environment),
        activeVersion: serving.version
      }
    } finally {
      if (!environmentRegistered) {
        await closeOCCdManagedTunnel(environmentId).catch(() => undefined)
      }
    }
  })
}

type DeployedOCCd = OCCdRunningAdoption & { created?: true }

async function deployOwnOCCd(
  context: OCCdRemoteContext<SshTarget>,
  slot: ReturnType<typeof managedOCCdSlot>,
  localOCCdDir: string,
  args: { force?: boolean; signal?: AbortSignal }
): Promise<DeployedOCCd | OCCdManagedDeferral> {
  const appVersion = getAppEnvironment().getVersion()
  const deployResult = await deployOCCd({
    ...slot,
    localOCCdDir,
    target: context.serverTarget,
    ...managedOCCdDeployPolicy(context, appVersion, args.force ? 'force' : 'connect'),
    force: args.force,
    appVersion
  })
  if (deployResult.outcome === 'installed-not-activated') {
    return {
      outcome: 'deferred',
      candidateVersion: deployResult.fullVersion,
      code: deployResult.code,
      reason: deployResult.reason,
      forceable:
        isForceableOCCdDeferral(deployResult.code) ||
        deployResult.code === OCCD_ACTIVATION_POLICY_REFUSED_CODE
    }
  }
  if (deployResult.outcome === 'already-active') {
    await wakeAlreadyActiveOCCd(slot)
  }
  const reprobe = () =>
    probeManagedOCCdReadiness(context, localOCCdDir, deployResult.fullVersion, args.signal)
  const readiness = await reprobe()
  await pruneManagedOCCdVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployResult.fullVersion,
    readiness
  })
  return {
    version: deployResult.fullVersion,
    readiness,
    reprobe,
    ...(deployResult.outcome === 'already-active' ? {} : { created: true as const })
  }
}

function assertMigrationFence(
  userDataPath: string,
  target: SshTarget | undefined,
  environmentId: string,
  name: string
): void {
  const fence = target ? resolveOCCdMigrationFence(userDataPath, target) : null
  if (
    fence?.state !== 'fenced' ||
    fence.cutover.destinationEnvironmentId !== environmentId ||
    fence.cutover.destinationName !== name
  ) {
    throw new Error('occd_migration_fence_required')
  }
}
