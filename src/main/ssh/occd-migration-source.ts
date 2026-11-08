/** Expose fenced-source checks/release through the cutover port; conversion owns terminal assessment, export and fence acquisition. */
import type { OCCdMigrationSourceKind } from '../../shared/occd-migration/occd-migration-source-kind'
import type {
  OCCdMigrationCatalogPayload,
  OCCdMigrationManifest
} from '../../shared/occd-migration/occd-migration-manifest'
import type { OCCdMigrationSourceCutover } from '../../shared/occd-migration/occd-migration-source-cutover'
import type {
  OCCdMigrationExportedBlob,
  OCCdMigrationManifestExportOptions
} from './occd-migration-manifest-export'
import type {
  OCCdMigrationFenceResult,
  OCCdMigrationFenceState
} from './occd-migration-source-fence'
import type { OCCdMigrationTerminalVerdict } from './occd-migration-terminal-gate'

export type OCCdMigrationSourceCutoverPort = {
  /** Before every stage and commit; throws unless the fenced source still matches the journal.
   * Returns the bytes of the blobs its manifest names, which that match proves are the journaled ones. */
  verifyFence: (cutover: OCCdMigrationSourceCutover) => OCCdMigrationExportedBlob[]
  /** Drops the fence, then the journal; only on proof the destination holds nothing. */
  releaseFence: (cutover: OCCdMigrationSourceCutover) => Promise<void>
}

type OCCdMigrationFenceAcquireArgs = {
  destinationEnvironmentId: string
  destinationName: string
  terminalProof: OCCdMigrationTerminalVerdict
  now?: () => Date
  signal?: AbortSignal
}

export type OCCdMigrationSource = OCCdMigrationSourceCutoverPort & {
  readonly kind: OCCdMigrationSourceKind
  readonly journalKey: string
  collectCatalog: () => OCCdMigrationCatalogPayload
  /** Rewrite paths before signing; export must not mutate source. */
  exportManifest: (options?: OCCdMigrationManifestExportOptions) => OCCdMigrationManifest
  /** Before the fence. Loss of contact is `unverifiable`, never `exited`. */
  assessTerminals: () => Promise<OCCdMigrationTerminalVerdict>
  retireProvenExitedTerminals: (proof: OCCdMigrationTerminalVerdict) => void
  /** Throws when the journal cannot be read: an unreadable record keeps the source fenced. */
  resolveFence: () => OCCdMigrationFenceState
  /** Journal, then fence, then flush, then the terminal re-check under the fence. */
  acquireFence: (args: OCCdMigrationFenceAcquireArgs) => Promise<OCCdMigrationFenceResult>
}
