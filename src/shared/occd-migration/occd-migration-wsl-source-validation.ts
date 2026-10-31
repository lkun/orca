import type {
  OCCdMigrationLocalWslManifestSource,
  OCCdMigrationManifest
} from './occd-migration-manifest'
import {
  MAX_OCCD_MIGRATION_FOLDER_WORKSPACES,
  MAX_OCCD_MIGRATION_REPOSITORIES,
  boundedStringArray,
  requiredString
} from './occd-migration-manifest-fields'
import { isOCCdMigrationLocalWslSource } from './occd-migration-source-kind'

export function parseLocalWslSource(
  value: Record<string, unknown>
): OCCdMigrationLocalWslManifestSource {
  // A non-SSH source naming an SSH target could only be a confused or forged manifest.
  if (value.sshTargetId !== undefined) {
    throw new Error('occd_migration_manifest_source_invalid')
  }
  const generation = value.generation
  if (!Number.isSafeInteger(generation) || Number(generation) < 1) {
    throw new Error('occd_migration_manifest_source_generation_invalid')
  }
  return {
    kind: 'local-wsl',
    distro: requiredString(value.distro, 'source.distro'),
    ...(value.distroGuid === undefined
      ? {}
      : { distroGuid: requiredString(value.distroGuid, 'source.distroGuid') }),
    scopeRepoIds: boundedStringArray(
      value.scopeRepoIds,
      MAX_OCCD_MIGRATION_REPOSITORIES,
      'source.scopeRepoIds_invalid'
    ),
    scopeFolderWorkspaceIds: boundedStringArray(
      value.scopeFolderWorkspaceIds,
      MAX_OCCD_MIGRATION_FOLDER_WORKSPACES,
      'source.scopeFolderWorkspaceIds_invalid'
    ),
    generation: Number(generation)
  }
}

/** The catalog a WSL source moves is exactly its declared scope; the host never infers scope. */
export function assertLocalWslScopeMatchesPayload(manifest: OCCdMigrationManifest): void {
  const { source, payload } = manifest
  if (!isOCCdMigrationLocalWslSource(source)) {
    return
  }
  const sameIds = (declared: readonly string[], rows: readonly { id: string }[]): boolean => {
    const ids = new Set(rows.map((row) => row.id))
    // A doubled declared id would let one payload row through unscoped.
    return (
      new Set(declared).size === declared.length &&
      declared.length === ids.size &&
      declared.every((id) => ids.has(id))
    )
  }
  if (
    !sameIds(source.scopeRepoIds, payload.repositories) ||
    !sameIds(source.scopeFolderWorkspaceIds, payload.folderWorkspaces)
  ) {
    throw new Error('occd_migration_manifest_source_scope_mismatch')
  }
}
