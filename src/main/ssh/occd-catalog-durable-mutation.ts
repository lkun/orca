import type { OCCdMigrationCatalogState } from '../../shared/occd-migration/occd-migration-manifest'

export async function resolveDurableOCCdCatalogMutation(
  mutate: () => Promise<OCCdMigrationCatalogState>,
  read: () => Promise<OCCdMigrationCatalogState>,
  accepted: (state: OCCdMigrationCatalogState) => boolean
) {
  try {
    return await mutate()
  } catch (mutationError) {
    let observed: OCCdMigrationCatalogState
    try {
      observed = await read()
    } catch {
      throw mutationError
    }
    if (!accepted(observed)) {
      throw mutationError
    }
  }
  // State reads may reflect unflushed mutations; an idempotent acknowledgment proves durability.
  return mutate()
}
