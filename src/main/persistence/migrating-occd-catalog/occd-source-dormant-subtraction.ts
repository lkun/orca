import type { OCCdMigrationManifest } from '../../../shared/occd-migration/occd-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { subtractOCCdSourceWorktreeMetadata } from './occd-source-worktree-metadata'
import { subtractOCCdMigrationSourceAutomationState } from './occd-source-automation-subtraction'
import { subtractOCCdMigrationSourceWorkspaceSession } from './occd-source-workspace-session-subtraction'
import { subtractOCCdMigrationClientState } from './occd-source-client-subtraction'

/** Mutate a delta-view copy only. */
export function subtractOCCdMigrationSourceDormantState(
  state: PersistedState,
  manifest: OCCdMigrationManifest
): void {
  // Include state a downgraded build added even when the manifest had none.
  subtractOCCdSourceWorktreeMetadata(state, manifest)
  subtractOCCdMigrationSourceAutomationState(state, manifest)
  const dormant = manifest.payload.dormantState
  if (!dormant) {
    return
  }
  dormant.worktreeLineage.forEach((entry) => delete state.worktreeLineageById[entry.sourceKey])
  dormant.workspaceLineage.forEach(
    (entry) => delete state.workspaceLineageByChildKey[entry.sourceKey]
  )
  for (const preset of dormant.sparsePresets) {
    const remaining = (state.sparsePresetsByRepo[preset.repoId] ?? []).filter(
      (entry) => entry.id !== preset.id
    )
    if (remaining.length > 0) {
      state.sparsePresetsByRepo[preset.repoId] = remaining
    } else {
      delete state.sparsePresetsByRepo[preset.repoId]
    }
  }
  for (const entry of dormant.retiredWorktreeNames) {
    delete state.retiredWorktreeNamesByRepo?.[entry.repoId]
  }
  subtractOCCdMigrationSourceWorkspaceSession(state, manifest)
  subtractOCCdMigrationClientState(state, manifest)
  // Retain snapshot files: the prior durable profile and rollback evidence can still reference them.
}
