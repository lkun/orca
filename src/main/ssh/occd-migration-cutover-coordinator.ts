/** Keep source authority until durable destination commit. Verify the fenced export before stage/commit; resolve lost replies by catalog reads and persist journal transitions before returning. Never release a committed destination. */
import type {
  OCCdMigrationCatalogAbortResult,
  OCCdMigrationCatalogReference,
  OCCdMigrationCatalogReferenceAbortResult,
  OCCdMigrationCatalogState,
  OCCdMigrationManifest
} from '../../shared/occd-migration/occd-migration-manifest'
import type {
  OCCdMigrationSnapshotChunkRequest,
  OCCdMigrationSnapshotChunkResult
} from '../../shared/occd-migration/occd-migration-scrollback'
import type {
  OCCdMigrationSourceCutover,
  OCCdMigrationSourceCutoverPhase
} from '../../shared/occd-migration/occd-migration-source-cutover'
import { resolveDurableOCCdCatalogMutation } from './occd-catalog-durable-mutation'
import { OCCD_MIGRATION_DESTINATION_UNSUPPORTED } from './occd-migration-catalog-client'
import { occdMigrationRequestFits } from './occd-migration-manifest-export'
import {
  listOCCdMigrationSourceCutovers,
  writeOCCdMigrationSourceCutover
} from './occd-migration-cutover-journal'
import type { OCCdMigrationSourceCutoverPort } from './occd-migration-source'
import {
  transferOCCdMigrationSnapshots,
  type OCCdMigrationSnapshotSource
} from './occd-migration-snapshot-coordinator'
import type { OCCdMigrationPreflightStore } from './targets/ssh-target-occd-preflight'
import { sshRelayMigrationCutoverPort } from './occd-migration-ssh-relay-source'
import type { SshTargetOCCdClaims } from './targets/ssh-target-occd-claims'

export type OCCdMigrationDestinationCatalog = {
  readState: (manifest: OCCdMigrationManifest) => Promise<OCCdMigrationCatalogState>
  stage: (manifest: OCCdMigrationManifest) => Promise<OCCdMigrationCatalogState>
  commit: (manifest: OCCdMigrationManifest) => Promise<OCCdMigrationCatalogState>
  abort: (manifest: OCCdMigrationManifest) => Promise<OCCdMigrationCatalogAbortResult>
  /** Use identity-only abort when the journal's full manifest cannot fit a request. */
  abortByReference: (
    manifest: OCCdMigrationCatalogReference
  ) => Promise<OCCdMigrationCatalogReferenceAbortResult>
  stageChunk: (
    request: OCCdMigrationSnapshotChunkRequest
  ) => Promise<OCCdMigrationSnapshotChunkResult>
}

export type OCCdMigrationCutoverContext = {
  userDataPath: string
  store: OCCdMigrationPreflightStore & OCCdMigrationSnapshotSource
  claims: SshTargetOCCdClaims
  destination: OCCdMigrationDestinationCatalog
  /** Rebuild copied stores for each check so concurrent edits remain visible. */
  freshSource?: () => OCCdMigrationPreflightStore
  /** The fenced source; defaults to the relay-era SSH target the journal names. */
  source?: OCCdMigrationSourceCutoverPort
  now?: () => Date
}

function cutoverSource(context: OCCdMigrationCutoverContext): OCCdMigrationSourceCutoverPort {
  return context.source ?? sshRelayMigrationCutoverPort(context)
}

export async function stageOCCdMigrationDestination(
  context: OCCdMigrationCutoverContext,
  migrationId: string
): Promise<OCCdMigrationSourceCutover> {
  let cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return cutover
  }
  assertSourceUnchanged(context, cutover)
  const { destination } = context
  const read = await destination.readState(cutover.manifest)
  const state =
    read.state === 'committed'
      ? await confirmDurableCommit(destination, cutover.manifest)
      : await resolveDurableOCCdCatalogMutation(
          () => destination.stage(cutover.manifest),
          () => destination.readState(cutover.manifest),
          (observed) => observed.state !== 'absent'
        )
  cutover = recordObservedState(context, cutover, state)
  if (state.state === 'staged') {
    await transferOCCdMigrationSnapshots({
      source: context.store,
      manifest: cutover.manifest,
      state,
      destination: { readState: destination.readState, stageChunk: destination.stageChunk }
    })
  }
  return cutover
}

export async function commitOCCdMigrationDestination(
  context: OCCdMigrationCutoverContext,
  migrationId: string
): Promise<OCCdMigrationSourceCutover> {
  const staged = await stageOCCdMigrationDestination(context, migrationId)
  if (staged.phase !== 'destination-staged') {
    return staged
  }
  assertSourceUnchanged(context, staged)
  const { destination } = context
  // A lost commit reply may hide success; catalog read decides the next step.
  const state = await resolveDurableOCCdCatalogMutation(
    () => destination.commit(staged.manifest),
    () => destination.readState(staged.manifest),
    (observed) => observed.state === 'committed'
  )
  if (state.state !== 'committed') {
    throw new Error(`occd_migration_commit_not_committed:${state.state}`)
  }
  return recordObservedState(context, staged, state)
}

export type OCCdMigrationAbortResult =
  | { outcome: 'released'; evidence: 'catalog-absent' | 'destination-unsupported' }
  | { outcome: 'refused'; code: string; reason: string }

/** Release only on proven destination absence; default drops journal/fence, while delta moves retain the fence. */
export async function abortOCCdMigrationCutover(
  context: OCCdMigrationCutoverContext,
  migrationId: string,
  release: (cutover: OCCdMigrationSourceCutover) => Promise<void> = (cutover) =>
    cutoverSource(context).releaseFence(cutover)
): Promise<OCCdMigrationAbortResult> {
  const cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return committedRefusal()
  }
  const { destination } = context
  // Older journals can hold oversized manifests; identity-only abort must still release them.
  if (!occdMigrationRequestFits({ manifest: cutover.manifest })) {
    const aborted = await destination.abortByReference(cutover.manifest)
    if (aborted.state === 'committed') {
      return committedRefusal()
    }
    await release(cutover)
    return { outcome: 'released', evidence: 'catalog-absent' }
  }
  let state: OCCdMigrationCatalogState
  try {
    state = await destination.readState(cutover.manifest)
  } catch (error) {
    // Unsupported proves absence only before any stage could have landed.
    if (isDestinationUnsupported(error) && cutover.phase === 'source-fenced') {
      await release(cutover)
      return { outcome: 'released', evidence: 'destination-unsupported' }
    }
    throw error
  }
  if (state.state !== 'committed') {
    state = await abortWithRecovery(destination, cutover.manifest)
  }
  if (state.state === 'committed') {
    recordObservedState(context, cutover, await confirmDurableCommit(destination, cutover.manifest))
    return committedRefusal()
  }
  if (state.state !== 'absent') {
    throw new Error(`occd_migration_abort_not_absent:${state.state}`)
  }
  await release(cutover)
  return { outcome: 'released', evidence: 'catalog-absent' }
}

/** Committed reads may be unflushed memory; require the idempotent commit acknowledgement to prove durability. */
export async function confirmDurableCommit(
  destination: OCCdMigrationDestinationCatalog,
  manifest: OCCdMigrationManifest
): Promise<OCCdMigrationCatalogState> {
  const state = await destination.commit(manifest)
  if (state.state !== 'committed') {
    throw new Error(`occd_migration_commit_not_committed:${state.state}`)
  }
  return state
}

function assertSourceUnchanged(
  context: OCCdMigrationCutoverContext,
  cutover: OCCdMigrationSourceCutover
): void {
  cutoverSource(context).verifyFence(cutover)
}

/** Persist observed state before returning. */
function recordObservedState(
  context: OCCdMigrationCutoverContext,
  cutover: OCCdMigrationSourceCutover,
  state: OCCdMigrationCatalogState
): OCCdMigrationSourceCutover {
  if (state.state === 'absent') {
    throw new Error('occd_migration_destination_catalog_absent')
  }
  if (
    state.migrationId !== cutover.migrationId ||
    state.manifestSha256 !== cutover.manifestSha256
  ) {
    throw new Error('occd_migration_destination_state_mismatch')
  }
  if (
    state.state === 'committed' &&
    (state.receipt.migrationId !== cutover.migrationId ||
      state.receipt.manifestSha256 !== cutover.manifestSha256)
  ) {
    throw new Error('occd_migration_destination_receipt_mismatch')
  }
  const phase: OCCdMigrationSourceCutoverPhase =
    state.state === 'committed' ? 'destination-committed' : 'destination-staged'
  if (phase === cutover.phase) {
    return cutover
  }
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    // Never regress a proven commit.
    return cutover
  }
  const next: OCCdMigrationSourceCutover = {
    ...cutover,
    phase,
    updatedAt: (context.now ?? (() => new Date()))().toISOString()
  }
  writeOCCdMigrationSourceCutover(context.userDataPath, next)
  return next
}

/** Aborts staging; a failed abort is decided by a re-read, never assumed. */
export async function abortWithRecovery(
  destination: OCCdMigrationDestinationCatalog,
  manifest: OCCdMigrationManifest
): Promise<OCCdMigrationCatalogState> {
  try {
    return await destination.abort(manifest)
  } catch (abortError) {
    try {
      const observed = await destination.readState(manifest)
      if (observed.state === 'committed') {
        return observed
      }
      if (observed.state === 'absent') {
        // Absent reads may predate flush; repeat abort to prove durable absence.
        return await destination.abort(manifest)
      }
    } catch {
      // Keep the original failure and fence while abort remains unverifiable.
    }
    throw abortError
  }
}

function requireCutover(userDataPath: string, migrationId: string): OCCdMigrationSourceCutover {
  const cutover = listOCCdMigrationSourceCutovers(userDataPath).find(
    (entry) => entry.migrationId === migrationId
  )
  if (!cutover) {
    throw new Error('occd_migration_source_cutover_not_found')
  }
  return cutover
}

function committedRefusal(): OCCdMigrationAbortResult {
  return {
    outcome: 'refused',
    code: 'occd_migration_committed_source_cannot_be_released',
    reason: 'This host’s OCC server already holds this migration; it can only move forward.'
  }
}

function isDestinationUnsupported(error: unknown): boolean {
  return error instanceof Error && error.message === OCCD_MIGRATION_DESTINATION_UNSUPPORTED
}
