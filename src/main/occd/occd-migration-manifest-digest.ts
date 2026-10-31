import { createHash } from 'node:crypto'
import {
  occdMigrationManifestHashInput,
  serializeOCCdMigrationValue,
  type OCCdMigrationManifest
} from '../../shared/occd-migration/occd-migration-manifest'

export function computeOCCdMigrationManifestSha256(
  manifest: Omit<OCCdMigrationManifest, 'manifestSha256'>
): string {
  return createHash('sha256').update(occdMigrationManifestHashInput(manifest)).digest('hex')
}

/** Hash the received manifest: unknown fields from newer peers are part of its signature. */
export function assertOCCdMigrationManifestDigest(manifest: unknown): void {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('occd_migration_manifest_invalid')
  }
  const unsigned = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== 'manifestSha256')
  )
  const digest = createHash('sha256').update(serializeOCCdMigrationValue(unsigned)).digest('hex')
  if (!('manifestSha256' in manifest) || digest !== manifest.manifestSha256) {
    throw new Error('occd_migration_manifest_digest_mismatch')
  }
}
