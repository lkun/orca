import type {
  OCCdMigrationCatalogAbortResult,
  OCCdMigrationCatalogReference,
  OCCdMigrationCatalogReferenceAbortResult,
  OCCdMigrationCatalogState,
  OCCdMigrationManifest
} from '../../shared/occd-migration/occd-migration-manifest'
import type { OCCdMigrationBlobDescriptor } from '../../shared/occd-migration/occd-migration-blob-transfer'
import type { Store } from '../persistence'

/** A moved history waits while a shell runs in its worktree: that shell would overwrite it. */
type WorktreeHasLiveShells = (worktreeId: string) => boolean

type OCCdMigrationCatalogFlushStore = Partial<Pick<Store, 'flushPendingOrThrowAsync'>>
type OCCdMigrationCatalogStageStore = OCCdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'stageOCCdMigrationCatalog'>>
type OCCdMigrationCatalogCommitStore = OCCdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'commitStagedOCCdMigrationCatalog' | 'installOCCdMigrationReceivedBlobs'>>
type OCCdMigrationCatalogAbortStore = OCCdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedOCCdMigrationCatalog'>>
type OCCdMigrationCatalogAbortByReferenceStore = OCCdMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedOCCdMigrationCatalogByReference'>>

export async function stageOCCdMigrationCatalogDurably(args: {
  store: OCCdMigrationCatalogStageStore
  manifest: OCCdMigrationManifest
  signal?: AbortSignal
}): Promise<OCCdMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.stageOCCdMigrationCatalog!(args.manifest)
  await flushMigrationState(args.store, args.signal)
  return result
}

export async function commitStagedOCCdMigrationCatalogDurably(args: {
  store: OCCdMigrationCatalogCommitStore
  manifest: OCCdMigrationManifest
  signal?: AbortSignal
  expectedBlobs?: readonly OCCdMigrationBlobDescriptor[]
  onDurableCommit: () => void
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): Promise<OCCdMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.commitStagedOCCdMigrationCatalog!(
    args.manifest,
    args.expectedBlobs ? { expectedBlobs: args.expectedBlobs } : {}
  )
  await flushMigrationState(args.store, args.signal)
  args.onDurableCommit()
  installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  return result
}

/** After the durable commit, on its retries and state queries; the store load retries too. */
function installReceivedBlobs(
  store: Partial<Pick<Store, 'installOCCdMigrationReceivedBlobs'>>,
  manifest: OCCdMigrationManifest,
  worktreeHasLiveShells: WorktreeHasLiveShells | undefined
): void {
  try {
    store.installOCCdMigrationReceivedBlobs?.(manifest, { worktreeHasLiveShells })
  } catch (error) {
    // The catalog is committed; a failed install keeps its blob for the next retry.
    console.error('[occd-migration] installing received blobs failed:', error)
  }
}

export async function abortStagedOCCdMigrationCatalogDurably(args: {
  store: OCCdMigrationCatalogAbortStore
  manifest: OCCdMigrationManifest
  signal?: AbortSignal
}): Promise<OCCdMigrationCatalogAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedOCCdMigrationCatalog!(args.manifest)
  // An already-absent retry may follow an in-memory abort whose flush failed.
  if (result.state === 'absent') {
    await flushMigrationState(args.store, args.signal)
    return { ...result, durableAbsent: true }
  }
  return result
}

export async function abortStagedOCCdMigrationCatalogByReferenceDurably(args: {
  store: OCCdMigrationCatalogAbortByReferenceStore
  reference: OCCdMigrationCatalogReference
  signal?: AbortSignal
}): Promise<OCCdMigrationCatalogReferenceAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedOCCdMigrationCatalogByReference!(args.reference)
  await flushMigrationState(args.store, args.signal)
  // Either answer is flushed first, so a source that cannot re-send the manifest may act on it.
  return result.state === 'absent'
    ? { ...result, durableAbsent: true }
    : { ...result, durableCommitted: true }
}

export function getOCCdMigrationCatalogState(args: {
  store: Partial<
    Pick<Store, 'getOCCdMigrationCatalogState' | 'installOCCdMigrationReceivedBlobs'>
  >
  manifest: OCCdMigrationManifest
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): OCCdMigrationCatalogState {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.getOCCdMigrationCatalogState!(args.manifest)
  if (result.state === 'committed') {
    installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  }
  return result
}

function flushMigrationState(
  store: OCCdMigrationCatalogFlushStore,
  signal?: AbortSignal
): Promise<void> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  return store.flushPendingOrThrowAsync!({
    signal,
    drainToStableGeneration: false
  })
}
