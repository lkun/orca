import {
  isRetainedOCCdMigrationSourceCutover,
  type OCCdMigrationSourceCutover
} from '../../../shared/occd-migration/occd-migration-source-cutover'
import {
  getOCCdSshDeployment,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { listOCCdMigrationSourceCutovers } from '../../ssh/occd-migration-cutover-journal'

type OCCdManagedPendingMigration = {
  migrationId: string
  environmentId: string
  name: string
  sshTargetId: string
  phase: OCCdMigrationSourceCutover['phase']
  startedAt: string
}

/** Unreadable journals must not look like absent migrations. */
export function listPendingManagedOCCdMigrations(
  userDataPath: string
): OCCdManagedPendingMigration[] {
  return (
    listOCCdMigrationSourceCutovers(userDataPath)
      // Committed/retained journals preserve downgrade recovery, not pending migration work.
      .filter(
        (cutover) =>
          cutover.phase !== 'source-retired' && !isRetainedOCCdMigrationSourceCutover(cutover)
      )
      .map((cutover) => ({
        migrationId: cutover.migrationId,
        environmentId: cutover.destinationEnvironmentId,
        name: cutover.destinationName,
        sshTargetId: cutover.sshTargetId,
        phase: cutover.phase,
        startedAt: cutover.startedAt
      }))
  )
}

export function findIncompleteManagedOCCdMigration(
  userDataPath: string,
  environmentId: string
): OCCdManagedPendingMigration | null {
  return (
    listPendingManagedOCCdMigrations(userDataPath).find(
      (migration) => migration.environmentId === environmentId
    ) ?? null
  )
}

export function environmentMatchesManagedOCCdCutover(
  environment: KnownRuntimeEnvironment,
  cutover: OCCdMigrationSourceCutover
): boolean {
  const deployment = getOCCdSshDeployment(environment)
  return (
    environment.id === cutover.destinationEnvironmentId &&
    environment.name === cutover.destinationName &&
    deployment?.sshTargetId === cutover.sshTargetId &&
    deployment.sshTargetGeneration === cutover.sshTargetGeneration
  )
}
