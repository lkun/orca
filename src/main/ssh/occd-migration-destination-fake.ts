import { vi, type Mock } from 'vitest'
import type {
  OCCdMigrationCatalogState,
  OCCdMigrationManifest
} from '../../shared/occd-migration/occd-migration-manifest'
import { parseOCCdMigrationManifest } from '../../shared/occd-migration/occd-migration-manifest-validation'
import { advertisedOCCdMigrationDestinationCapabilities } from '../occd/occd-migration-destination-capabilities'
import { assertOCCdMigrationManifestDigest } from '../occd/occd-migration-manifest-digest'
import type { Store } from '../persistence/loading-store/store'
import type { OCCdMigrationDestinationCatalog } from './occd-migration-cutover-coordinator'

type Catalog = OCCdMigrationDestinationCatalog

export type FakeOCCdMigrationDestination = { commits: number } & {
  [Method in keyof Catalog]: Mock<Catalog[Method]>
}

/** Model idempotent stage and receipt-keyed commit with separate catalog state for each migration, including later deltas. */
export function fakeOCCdMigrationDestination(): FakeOCCdMigrationDestination {
  const states = new Map<string, 'absent' | 'staged' | 'committed'>()
  const stateOf = (manifest: Pick<OCCdMigrationManifest, 'migrationId'>) =>
    states.get(manifest.migrationId) ?? 'absent'
  const view = (manifest: OCCdMigrationManifest): OCCdMigrationCatalogState => {
    const state = stateOf(manifest)
    const base = { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 }
    if (state === 'committed') {
      return {
        ...base,
        state,
        receipt: {
          version: 1,
          migrationId: manifest.migrationId,
          manifestSha256: manifest.manifestSha256,
          source: manifest.source,
          importedAt: '2026-10-01T00:00:00.000Z',
          repositoryIds: [],
          projectGroupIds: [],
          folderWorkspaceIds: []
        }
      }
    }
    return state === 'staged'
      ? { ...base, state, stagedAt: '2026-10-01T00:00:00.000Z', snapshotUploads: [] }
      : { ...base, state }
  }
  const destination: FakeOCCdMigrationDestination = {
    commits: 0,
    readState: vi.fn<Catalog['readState']>(async (manifest: OCCdMigrationManifest) =>
      view(manifest)
    ),
    stage: vi.fn<Catalog['stage']>(async (manifest: OCCdMigrationManifest) => {
      if (stateOf(manifest) === 'absent') {
        states.set(manifest.migrationId, 'staged')
      }
      return view(manifest)
    }),
    commit: vi.fn<Catalog['commit']>(async (manifest: OCCdMigrationManifest) => {
      if (stateOf(manifest) === 'staged') {
        states.set(manifest.migrationId, 'committed')
        destination.commits += 1
      }
      return view(manifest)
    }),
    abort: vi.fn<Catalog['abort']>(async (manifest: OCCdMigrationManifest) => {
      const aborted = stateOf(manifest) === 'staged'
      if (aborted) {
        states.set(manifest.migrationId, 'absent')
      }
      return { ...view(manifest), aborted, ...(aborted ? {} : { durableAbsent: true as const }) }
    }),
    abortByReference: vi.fn<Catalog['abortByReference']>(async (manifest) => {
      const identity = {
        migrationId: manifest.migrationId,
        manifestSha256: manifest.manifestSha256
      }
      if (stateOf(manifest) === 'committed') {
        return { ...identity, state: 'committed', aborted: false }
      }
      const aborted = stateOf(manifest) === 'staged'
      states.delete(manifest.migrationId)
      return { ...identity, state: 'absent', aborted, durableAbsent: true }
    }),
    stageChunk: vi.fn<Catalog['stageChunk']>(),
    readCapabilities: vi.fn<Catalog['readCapabilities']>(async () => []),
    stageBlobChunk: vi.fn<Catalog['stageBlobChunk']>()
  }
  return destination
}

/** A host server's real import, behind manifests sent as the RPC handler receives them. */
export function storeBackedOCCdMigrationDestination(server: Store): Catalog {
  const sent = (manifest: OCCdMigrationManifest): OCCdMigrationManifest => {
    const raw = JSON.parse(JSON.stringify(manifest))
    assertOCCdMigrationManifestDigest(raw)
    return parseOCCdMigrationManifest(raw)
  }
  return {
    readState: async (manifest) => server.getOCCdMigrationCatalogState(sent(manifest)),
    stage: async (manifest) => server.stageOCCdMigrationCatalog(sent(manifest)),
    commit: async (manifest) => server.commitStagedOCCdMigrationCatalog(sent(manifest)),
    abort: async (manifest) => {
      const result = server.abortStagedOCCdMigrationCatalog(sent(manifest))
      return result.aborted ? result : { ...result, durableAbsent: true as const }
    },
    abortByReference: async (reference) =>
      server.abortStagedOCCdMigrationCatalogByReference(reference),
    stageChunk: async (request) => server.stageOCCdMigrationSnapshotChunk(request),
    readCapabilities: async () => advertisedOCCdMigrationDestinationCapabilities(),
    stageBlobChunk: async (request) => server.stageOCCdMigrationBlobChunk(request)
  }
}
