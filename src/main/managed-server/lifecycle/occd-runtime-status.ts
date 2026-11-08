import type { OCCdManagedRuntimeStatus } from '../../../shared/occd-managed-runtime'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import type { OCCdActivationTransaction } from '../activation/occd-activation-transaction'
import { readOCCdActivationTransaction } from '../activation/occd-activation-transaction-store'
import {
  requireManagedOCCdEnvironment,
  resolveLinkedOCCdContext
} from './occd-managed-runtime-context'
import { currentManagedOCCdUpdateDeferral } from './occd-managed-update-deferrals'
import { findIncompleteManagedOCCdMigration } from './occd-managed-migration-status'
import { collectManagedTerminalCensus } from '../../ssh/occd-terminal-census-client'
import { getAppEnvironment } from '../../../shared/app-environment'
import { bundledManagedOCCdVersion } from './occd-managed-auto-update'
import { availableManagedOCCdUpdate } from './occd-managed-update-decision'

/** Read host records without repairing them. */
export async function getManagedOCCdRuntimeStatus(
  userDataPath: string,
  selector: string,
  signal?: AbortSignal
): Promise<OCCdManagedRuntimeStatus> {
  const { environment, deployment } = requireManagedOCCdEnvironment(userDataPath, selector)
  const { status, record, serverTarget } = await runTargetLifecycle(
    deployment.sshTargetId,
    async () => {
      const context = await resolveLinkedOCCdContext(environment, deployment, signal)
      const record = context.activationRecord
      const transaction = await readOCCdActivationTransaction({
        conn: context.connection,
        host: context.host,
        remoteHome: context.remoteHome,
        signal
      })
      const status: OCCdManagedRuntimeStatus = {
        environmentId: environment.id,
        sshTargetId: context.target.id,
        activeVersion: record.active,
        activeAppVersion: record.active ? (record.activeAppVersion ?? null) : null,
        previousVersion: record.previous,
        activatedAt: record.activatedAt,
        rollbackAvailable: Boolean(record.previous && record.snapshot),
        recovery: transaction ? managedRecoveryStatus(transaction) : null,
        terminals: await collectManagedTerminalCensus(userDataPath, environment, record),
        migration: migrationStatus(userDataPath, environment.id),
        deferredUpdate: currentManagedOCCdUpdateDeferral(environment.id, record)
      }
      return { status, record, serverTarget: context.serverTarget }
    }
  )
  // Outside the host queue: hashing the local template must not hold up host actions.
  // A local template fault hides only the offer, never the host's status.
  const candidateVersion = await bundledManagedOCCdVersion(serverTarget).catch(() => null)
  return {
    ...status,
    availableUpdate: availableManagedOCCdUpdate({
      record,
      candidateVersion,
      appVersion: getAppEnvironment().getVersion(),
      deferredCandidateVersion: status.deferredUpdate?.candidateVersion ?? null
    })
  }
}

function managedRecoveryStatus(
  transaction: OCCdActivationTransaction
): NonNullable<OCCdManagedRuntimeStatus['recovery']> {
  switch (transaction.operation) {
    case 'activate':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.candidateVersion,
        startedAt: transaction.startedAt
      }
    case 'rollback':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.targetVersion,
        startedAt: transaction.startedAt
      }
    case 'decommission':
      return {
        operation: transaction.operation,
        phase: transaction.phase,
        version: transaction.activeVersion,
        startedAt: transaction.startedAt
      }
  }
}

function migrationStatus(
  userDataPath: string,
  environmentId: string
): OCCdManagedRuntimeStatus['migration'] {
  const migration = findIncompleteManagedOCCdMigration(userDataPath, environmentId)
  return migration
    ? { migrationId: migration.migrationId, phase: migration.phase, startedAt: migration.startedAt }
    : null
}
