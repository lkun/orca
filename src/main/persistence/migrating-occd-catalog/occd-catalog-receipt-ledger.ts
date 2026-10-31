// Commit receipts remain authoritative indefinitely; abandoned stages expire.
import { MAX_OCCD_MIGRATION_IMPORT_RECEIPTS } from '../../../shared/occd-migration/occd-migration-manifest-validation'
import type {
  OCCdMigrationImportReceipt,
  OCCdMigrationManifest
} from '../../../shared/occd-migration/occd-migration-manifest'
import { MAX_OCCD_MIGRATION_EVICTED_RECEIPTS } from '../../../shared/occd-migration/occd-migration-evicted-receipts'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  occdMigrationStagingKey,
  type OCCdMigrationRequestIdentity
} from './occd-migration-staged-file'

// Allow a week for clients that went offline mid-move.
export const OCCD_MIGRATION_STAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function findOCCdMigrationImportReceipt(
  state: PersistedState,
  manifest: OCCdMigrationManifest
): OCCdMigrationImportReceipt | undefined {
  const receipt = state.occdMigrationImportReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  if (receipt) {
    return receipt
  }
  const evicted = state.occdMigrationEvictedReceipts?.find(
    (entry) => entry.migrationId === manifest.migrationId
  )
  // Rebuild the remaining receipt fields from the manifest.
  return evicted
    ? {
        version: manifest.version,
        migrationId: evicted.migrationId,
        manifestSha256: evicted.manifestSha256,
        source: structuredClone(manifest.source),
        importedAt: evicted.importedAt,
        repositoryIds: manifest.payload.repositories.map((repo) => repo.id),
        projectGroupIds: manifest.payload.projectGroups.map((group) => group.id),
        folderWorkspaceIds: manifest.payload.folderWorkspaces.map((workspace) => workspace.id)
      }
    : undefined
}

/** Compact evicted receipts without losing proof of commit. */
export function recordOCCdMigrationImportReceipt(
  state: PersistedState,
  receipt: OCCdMigrationImportReceipt
): void {
  const receipts = [...(state.occdMigrationImportReceipts ?? []), receipt]
  const overflow = receipts.length - MAX_OCCD_MIGRATION_IMPORT_RECEIPTS
  if (overflow > 0) {
    state.occdMigrationEvictedReceipts = [
      ...(state.occdMigrationEvictedReceipts ?? []),
      ...receipts.slice(0, overflow).map(({ migrationId, manifestSha256, importedAt }) => ({
        migrationId,
        manifestSha256,
        importedAt
      }))
    ].slice(-MAX_OCCD_MIGRATION_EVICTED_RECEIPTS)
  }
  state.occdMigrationImportReceipts = receipts.slice(-MAX_OCCD_MIGRATION_IMPORT_RECEIPTS)
}

export function isLiveOCCdMigrationStage(stagedAt: string, now: number): boolean {
  return now - Date.parse(stagedAt) < OCCD_MIGRATION_STAGE_TTL_MS
}

export function expireOCCdMigrationStages(state: PersistedState, now: number): boolean {
  const staged = state.occdMigrationStagedCatalogs ?? []
  const live = staged.filter((entry) => isLiveOCCdMigrationStage(entry.stagedAt, now))
  if (live.length === staged.length) {
    return false
  }
  state.occdMigrationStagedCatalogs = live
  return true
}

export type OCCdMigrationCommitGenerationRuntime = Pick<
  StoreRuntimeState,
  'writeGeneration' | 'lastDurableWriteGeneration' | 'occdMigrationCommitWriteGenerations'
>

/** Call right after the commit's `scheduleSave`; `generationBefore` is read just before it. */
export function recordOCCdMigrationCommitWriteGeneration(
  runtime: OCCdMigrationCommitGenerationRuntime,
  migration: OCCdMigrationRequestIdentity,
  generationBefore: number
): void {
  // Suppressed saves never advance generation; only a disk-loaded receipt can prove durability.
  runtime.occdMigrationCommitWriteGenerations.set(
    occdMigrationStagingKey(migration),
    runtime.writeGeneration > generationBefore ? runtime.writeGeneration : Number.POSITIVE_INFINITY
  )
}

/** Require disk durability before consuming blobs a restart might need to retry. */
export function isOCCdMigrationCommitDurable(
  runtime: OCCdMigrationCommitGenerationRuntime,
  migration: OCCdMigrationRequestIdentity
): boolean {
  const key = occdMigrationStagingKey(migration)
  const required = runtime.occdMigrationCommitWriteGenerations.get(key)
  if (required === undefined) {
    return true
  }
  if (runtime.lastDurableWriteGeneration < required) {
    return false
  }
  runtime.occdMigrationCommitWriteGenerations.delete(key)
  return true
}
