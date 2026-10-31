/** Check every blob kind against destination capabilities before uploading. Resume from staged offsets and confirm lost acknowledgements by re-reading state; never assume delivery or silently omit unsupported data. */
import {
  OCCD_MIGRATION_BLOB_CHUNK_BYTES,
  type OCCdMigrationBlobChunkRequest,
  type OCCdMigrationBlobChunkResult,
  type OCCdMigrationBlobDescriptor,
  assertOCCdMigrationBlobSet,
  findUnsupportedMigrationBlobKind,
  occdMigrationBlobIdentity,
  occdMigrationBlobKindUnsupportedBlocker,
  sameOCCdMigrationBlob
} from '../../shared/occd-migration/occd-migration-blob-transfer'
import type {
  OCCdMigrationCatalogState,
  OCCdMigrationManifest
} from '../../shared/occd-migration/occd-migration-manifest'

export type OCCdMigrationBlobSource = {
  /** Return the descriptor's exact hashed bytes at offset, up to maxBytes. */
  readChunk: (
    descriptor: OCCdMigrationBlobDescriptor,
    offset: number,
    maxBytes: number
  ) => Promise<Buffer>
}

export type OCCdMigrationBlobDestination = {
  readCapabilities: () => Promise<readonly string[]>
  readState: (manifest: OCCdMigrationManifest) => Promise<OCCdMigrationCatalogState>
  stageChunk: (request: OCCdMigrationBlobChunkRequest) => Promise<OCCdMigrationBlobChunkResult>
}

type OCCdMigrationBlobTransfer = {
  source: OCCdMigrationBlobSource
  manifest: OCCdMigrationManifest
  blobs: readonly OCCdMigrationBlobDescriptor[]
  destination: OCCdMigrationBlobDestination
}

type StagedCatalogState = Extract<OCCdMigrationCatalogState, { state: 'staged' }>

export async function transferOCCdMigrationBlobs(
  transfer: OCCdMigrationBlobTransfer
): Promise<void> {
  if (transfer.blobs.length === 0) {
    return
  }
  assertOCCdMigrationBlobSet(transfer.blobs)
  const unsupported = findUnsupportedMigrationBlobKind(
    transfer.blobs,
    await transfer.destination.readCapabilities()
  )
  if (unsupported) {
    throw new Error(occdMigrationBlobKindUnsupportedBlocker(unsupported))
  }
  const offsets = receivedOffsets(transfer, await readStagedState(transfer))
  for (const blob of transfer.blobs) {
    let offset = offsets.get(occdMigrationBlobIdentity(blob)) ?? 0
    while (offset < blob.byteLength) {
      const bytes = await transfer.source.readChunk(
        blob,
        offset,
        Math.min(OCCD_MIGRATION_BLOB_CHUNK_BYTES, blob.byteLength - offset)
      )
      if (
        bytes.length === 0 ||
        bytes.length > OCCD_MIGRATION_BLOB_CHUNK_BYTES ||
        offset + bytes.length > blob.byteLength
      ) {
        throw new Error(`occd_migration_source_blob_changed:${blob.blobKind}`)
      }
      const request: OCCdMigrationBlobChunkRequest = {
        migrationId: transfer.manifest.migrationId,
        manifestSha256: transfer.manifest.manifestSha256,
        blob: { ...blob },
        offset,
        bytesBase64: bytes.toString('base64')
      }
      offset = await stageChunkWithRecovery(transfer, request, offset + bytes.length)
    }
  }
  assertAllReceived(transfer, await readStagedState(transfer))
}

async function readStagedState(transfer: OCCdMigrationBlobTransfer): Promise<StagedCatalogState> {
  const state = await transfer.destination.readState(transfer.manifest)
  if (state.state !== 'staged') {
    throw new Error('occd_migration_blob_catalog_not_staged')
  }
  return state
}

function receivedOffsets(
  transfer: OCCdMigrationBlobTransfer,
  state: StagedCatalogState
): Map<string, number> {
  const wanted = new Map(transfer.blobs.map((blob) => [occdMigrationBlobIdentity(blob), blob]))
  const offsets = new Map<string, number>()
  for (const upload of state.blobUploads ?? []) {
    const blob = wanted.get(occdMigrationBlobIdentity(upload))
    // A reused key with different bytes is another capture; restaging would mix them.
    if (!blob || !sameOCCdMigrationBlob(blob, upload)) {
      throw new Error(`occd_migration_blob_descriptor_conflict:${upload.blobKind}`)
    }
    offsets.set(occdMigrationBlobIdentity(upload), upload.receivedBytes)
  }
  return offsets
}

function assertAllReceived(transfer: OCCdMigrationBlobTransfer, state: StagedCatalogState): void {
  const received = receivedOffsets(transfer, state)
  for (const blob of transfer.blobs) {
    if (received.get(occdMigrationBlobIdentity(blob)) !== blob.byteLength) {
      throw new Error(`occd_migration_blob_transfer_incomplete:${blob.blobKind}`)
    }
  }
}

async function stageChunkWithRecovery(
  transfer: OCCdMigrationBlobTransfer,
  request: OCCdMigrationBlobChunkRequest,
  expectedOffset: number
): Promise<number> {
  try {
    const result = await transfer.destination.stageChunk(request)
    if (result.receivedBytes !== expectedOffset) {
      throw new Error('occd_migration_blob_ack_invalid')
    }
    return result.receivedBytes
  } catch (error) {
    try {
      const observed = await transfer.destination.readState(transfer.manifest)
      const received =
        observed.state === 'staged'
          ? observed.blobUploads?.find(
              (entry) =>
                occdMigrationBlobIdentity(entry) === occdMigrationBlobIdentity(request.blob)
            )?.receivedBytes
          : undefined
      if (received === expectedOffset) {
        return received
      }
    } catch {
      // Unverifiable chunks retain the original failure.
    }
    throw error
  }
}
