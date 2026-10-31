import type { OCCdMigrationStagedCatalog } from './occd-migration-manifest'
import {
  OCCD_MIGRATION_MANIFEST_VERSION,
  parseOCCdMigrationManifest
} from './occd-migration-manifest-validation'
import { isRecord } from './occd-migration-manifest-fields'

export const MAX_OCCD_MIGRATION_STAGED_CATALOGS = 4

export function normalizeOCCdMigrationStagedCatalogs(
  value: unknown
): OCCdMigrationStagedCatalog[] {
  if (!Array.isArray(value)) {
    return []
  }
  const staged: OCCdMigrationStagedCatalog[] = []
  const seen = new Set<string>()
  for (let index = value.length - 1; index >= 0; index--) {
    try {
      const entry = parseStagedCatalog(value[index])
      if (!seen.has(entry.manifest.migrationId)) {
        seen.add(entry.manifest.migrationId)
        staged.push(entry)
        if (staged.length === MAX_OCCD_MIGRATION_STAGED_CATALOGS) {
          break
        }
      }
    } catch {
      // Invalid staging cannot prove fencing; drop it fail-closed.
    }
  }
  // Keep the migration journal runnable in the documented Node 18 rollback slot.
  return staged.reduceRight<OCCdMigrationStagedCatalog[]>((reversed, entry) => {
    reversed.push(entry)
    return reversed
  }, [])
}

function parseStagedCatalog(value: unknown): OCCdMigrationStagedCatalog {
  if (!isRecord(value) || value.version !== OCCD_MIGRATION_MANIFEST_VERSION) {
    throw new Error('occd_migration_staged_catalog_invalid')
  }
  const stagedAt = typeof value.stagedAt === 'string' ? value.stagedAt : ''
  if (!Number.isFinite(Date.parse(stagedAt))) {
    throw new Error('occd_migration_staged_at_invalid')
  }
  return {
    version: OCCD_MIGRATION_MANIFEST_VERSION,
    manifest: parseOCCdMigrationManifest(value.manifest),
    stagedAt
  }
}
