import { OCCD_MIGRATION_MANIFEST_VERSION } from '../../shared/occd-migration/occd-migration-manifest-validation'
import type { OCCdMigrationSourceCutover } from '../../shared/occd-migration/occd-migration-source-cutover'
import { computeOCCdMigrationManifestSha256 } from '../occd/occd-migration-manifest-digest'

export function occdMigrationCutoverFixture(
  migrationId = 'migration-1',
  sshTargetId = 'ssh-1',
  binding: { generation?: number; environmentId?: string; name?: string } = {}
): OCCdMigrationSourceCutover {
  const generation = binding.generation ?? 2
  const environmentId = binding.environmentId ?? 'env-1'
  const unsigned = {
    version: OCCD_MIGRATION_MANIFEST_VERSION,
    migrationId,
    createdAt: '2026-10-01T00:00:00.000Z',
    source: { sshTargetId, sshTargetGeneration: generation, targetLabel: 'Prod' },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
    destinationEnvironmentId: environmentId
  }
  const manifest = { ...unsigned, manifestSha256: computeOCCdMigrationManifestSha256(unsigned) }
  return {
    version: 1,
    migrationId,
    phase: 'source-fenced',
    startedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    destinationEnvironmentId: environmentId,
    destinationName: binding.name ?? 'Managed',
    sshTargetId,
    sshTargetGeneration: generation,
    manifestSha256: manifest.manifestSha256,
    provenPtyIds: [],
    manifest
  }
}
