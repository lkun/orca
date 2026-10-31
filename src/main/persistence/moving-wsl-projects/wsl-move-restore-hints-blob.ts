import { createHash } from 'node:crypto'
import type { OCCdMigrationBlobDescriptor } from '../../../shared/occd-migration/occd-migration-blob-transfer'
import { sameOCCdMigrationBlob } from '../../../shared/occd-migration/occd-migration-blob-transfer'
import {
  MAX_OCCD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES,
  OCCD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  OCCD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
  parseOCCdMigrationTerminalRestoreHintsDocument,
  type OCCdMigrationTerminalRestoreHint
} from '../../../shared/occd-migration/occd-migration-terminal-restore-hints'
import type { OCCdMigrationBlobSource } from '../../ssh/occd-migration-blob-coordinator'

export type WslMoveRestoreHintsBlob = {
  descriptor: OCCdMigrationBlobDescriptor
  bytes: Buffer
  source: OCCdMigrationBlobSource
}

/** Omit the blob when there are no hints. */
export function buildWslMoveRestoreHintsBlob(
  hints: readonly OCCdMigrationTerminalRestoreHint[]
): WslMoveRestoreHintsBlob | null {
  if (hints.length === 0) {
    return null
  }
  // Validate before staging so malformed hints fail while the source still owns the move.
  const document = parseOCCdMigrationTerminalRestoreHintsDocument({
    version: OCCD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
    hints: hints.map((hint) => ({ paneKey: hint.paneKey, cwd: hint.cwd }))
  })
  const bytes = Buffer.from(JSON.stringify(document), 'utf8')
  if (bytes.length > MAX_OCCD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES) {
    throw new Error('occd_migration_terminal_restore_hints_too_large')
  }
  const descriptor: OCCdMigrationBlobDescriptor = {
    blobKind: 'terminal-restore-hints',
    key: OCCD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length
  }
  return {
    descriptor,
    bytes,
    source: {
      readChunk: async (requested, offset, maxBytes) => {
        if (!sameOCCdMigrationBlob(requested, descriptor)) {
          throw new Error(`occd_migration_source_blob_changed:${requested.blobKind}`)
        }
        return bytes.subarray(offset, offset + maxBytes)
      }
    }
  }
}
