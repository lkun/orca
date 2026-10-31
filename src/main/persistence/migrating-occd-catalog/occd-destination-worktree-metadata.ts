import type { PersistedState } from '../../../shared/persisted-state-types'
import type { OCCdMigrationDormantStatePayload } from '../../../shared/occd-migration/occd-migration-manifest'
import { serializeOCCdMigrationValue } from '../../../shared/occd-migration/occd-migration-manifest'
import { canonicalWorktreeIdentity } from '../../../shared/worktree/identity'
import { composeWorktreeHostIdentity } from '../../../shared/worktree/host-qualified-identity'
import { omitDefaultWorktreeMetaFields } from '../../../shared/worktree/meta-persisted-defaults'

export function assertOCCdDestinationCanonicalMetadata(
  state: PersistedState,
  entries: OCCdMigrationDormantStatePayload['worktreeMeta']
): void {
  for (const { worktreeId, meta } of entries) {
    const alias = composeWorktreeHostIdentity('local', worktreeId)
    const identities = state.worktreeIdentityAliases?.[alias] ?? []
    const expectedKey = meta.instanceId
      ? canonicalWorktreeIdentity({
          worktreeId,
          executionHostId: 'local',
          instanceId: meta.instanceId
        })
      : undefined
    const candidates = new Set([
      ...identities,
      ...(expectedKey && state.worktreeMetaByIdentity?.[expectedKey] ? [expectedKey] : [])
    ])
    if (
      candidates.size > 1 ||
      [...candidates].some((key) => {
        const current = state.worktreeMetaByIdentity?.[key]
        return (
          !current ||
          key !== expectedKey ||
          serializeOCCdMigrationValue(omitDefaultWorktreeMetaFields(current)) !==
            serializeOCCdMigrationValue(omitDefaultWorktreeMetaFields(meta))
        )
      })
    ) {
      throw new Error(`occd_migration_dormant_id_conflict:worktree_meta:${worktreeId}`)
    }
  }
}
