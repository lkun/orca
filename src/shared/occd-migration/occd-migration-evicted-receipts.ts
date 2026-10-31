/** Keep enough of evicted receipts to answer committed; derive the remaining receipt from its manifest. */
import { isRecord } from './occd-migration-manifest-fields'

export const MAX_OCCD_MIGRATION_EVICTED_RECEIPTS = 4_096

export type OCCdMigrationEvictedReceipt = {
  migrationId: string
  manifestSha256: string
  importedAt: string
}

export function normalizeOCCdMigrationEvictedReceipts(
  value: unknown
): OCCdMigrationEvictedReceipt[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter(
      (entry): entry is OCCdMigrationEvictedReceipt =>
        isRecord(entry) &&
        typeof entry.migrationId === 'string' &&
        entry.migrationId.length > 0 &&
        typeof entry.manifestSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(entry.manifestSha256) &&
        typeof entry.importedAt === 'string' &&
        Number.isFinite(Date.parse(entry.importedAt))
    )
    .map(({ migrationId, manifestSha256, importedAt }) => ({
      migrationId,
      manifestSha256,
      importedAt
    }))
    .slice(-MAX_OCCD_MIGRATION_EVICTED_RECEIPTS)
}
