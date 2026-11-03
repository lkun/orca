// The manifest omits blobs; descriptor filenames make staged uploads resumable after restart.
import { readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  OCCD_MIGRATION_BLOB_KINDS,
  assertOCCdMigrationBlobSet,
  decodeOCCdMigrationBlobChunk,
  occdMigrationBlobIdentity,
  parseOCCdMigrationBlobDescriptor,
  sameOCCdMigrationBlob,
  type OCCdMigrationBlobChunkRequest,
  type OCCdMigrationBlobChunkResult,
  type OCCdMigrationBlobDescriptor,
  type OCCdMigrationBlobKind,
  type OCCdMigrationBlobUploadState
} from '../../../shared/occd-migration/occd-migration-blob-transfer'
import type { OCCdMigrationManifest } from '../../../shared/occd-migration/occd-migration-manifest'
import { syncDirectoryDurablySync } from '../../filesystem/durable-file-write'
import {
  appendOCCdMigrationStagedChunk,
  ensureOCCdMigrationDirectory,
  inspectOCCdMigrationFinalFile,
  linkOCCdMigrationStagedFile,
  occdMigrationFileMatches,
  occdMigrationStagedFileSize,
  occdMigrationStagingDirectory,
  occdMigrationStagingKey,
  pruneOCCdMigrationKeyedDirectories,
  pruneOCCdMigrationStagingDirectories,
  removeOCCdMigrationStagingDirectory,
  requireStagedOCCdMigrationManifest,
  type OCCdMigrationRequestIdentity
} from './occd-migration-staged-file'

const RECEIVED_DIRECTORY = 'received'
const STAGED_BLOB_NAME = /^([^.]+)\.([a-f0-9]{64})\.([1-9][0-9]*)\.part$/

type OCCdMigrationBlobName = Pick<OCCdMigrationBlobDescriptor, 'blobKind' | 'key'>

type ReceivedBlobPathResolver = (
  root: string,
  manifest: OCCdMigrationRequestIdentity,
  descriptor: OCCdMigrationBlobName
) => string

const receivedDirectoryPath: ReceivedBlobPathResolver = (root, manifest, descriptor) =>
  join(receivedBlobsDirectory(root, manifest), descriptor.blobKind, descriptor.key)

const RECEIVED_BLOB_DESTINATIONS: Record<OCCdMigrationBlobKind, ReceivedBlobPathResolver> = {
  'terminal-restore-hints': receivedDirectoryPath,
  'shell-history': receivedDirectoryPath,
  'agent-session-records': receivedDirectoryPath,
  'terminal-history': receivedDirectoryPath
}

export function getOCCdMigrationReceivedBlobPath(
  root: string,
  manifest: OCCdMigrationRequestIdentity,
  descriptor: OCCdMigrationBlobName
): string {
  return RECEIVED_BLOB_DESTINATIONS[descriptor.blobKind](root, manifest, descriptor)
}

export function listOCCdMigrationReceivedBlobNames(
  root: string,
  manifest: OCCdMigrationRequestIdentity,
  blobKind: OCCdMigrationBlobKind
): string[] {
  return readDirectory(join(receivedBlobsDirectory(root, manifest), blobKind))
}

export type OCCdMigrationBlobChunkStaging = {
  stagedManifest: OCCdMigrationManifest | null
  root: string
  request: OCCdMigrationBlobChunkRequest
}

export function stageOCCdMigrationBlobChunk(
  args: OCCdMigrationBlobChunkStaging
): OCCdMigrationBlobChunkResult {
  const manifest = requireStagedOCCdMigrationManifest(
    args.stagedManifest,
    args.request,
    'occd_migration_blob_catalog_not_staged'
  )
  const descriptor = parseOCCdMigrationBlobDescriptor(args.request.blob)
  const bytes = decodeOCCdMigrationBlobChunk(args.request.bytesBase64)
  const staged = stagedBlobDescriptors(args.root, manifest)
  const existing = staged.find(
    (entry) => occdMigrationBlobIdentity(entry) === occdMigrationBlobIdentity(descriptor)
  )
  if (existing && !sameOCCdMigrationBlob(existing, descriptor)) {
    // Replacing staged bytes requires abort and restage.
    throw new Error(`occd_migration_blob_descriptor_conflict:${descriptor.blobKind}`)
  }
  if (!existing) {
    assertOCCdMigrationBlobSet([...staged, descriptor])
  }
  const path = stagedBlobPath(args.root, manifest, descriptor)
  ensureOCCdMigrationDirectory(dirname(path))
  const receivedBytes = appendOCCdMigrationStagedChunk({
    channel: 'blob',
    path,
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    blobKind: descriptor.blobKind,
    key: descriptor.key,
    receivedBytes
  }
}

export function inspectOCCdMigrationBlobUploads(
  manifest: OCCdMigrationManifest,
  root: string
): OCCdMigrationBlobUploadState[] | undefined {
  const uploads = stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectReceivedBlob(root, manifest, descriptor) === 'matching'
        ? descriptor.byteLength
        : occdMigrationStagedFileSize(
            stagedBlobPath(root, manifest, descriptor),
            descriptor.byteLength
          )
  }))
  return uploads.length > 0 ? uploads : undefined
}

export function assertOCCdMigrationBlobsReady(
  manifest: OCCdMigrationManifest,
  root: string
): void {
  for (const upload of inspectOCCdMigrationBlobUploads(manifest, root) ?? []) {
    const label = `${upload.blobKind}:${upload.key}`
    const finalStatus = inspectReceivedBlob(root, manifest, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`occd_migration_blob_destination_conflict:${label}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`occd_migration_blob_incomplete:${label}`)
    }
    if (
      finalStatus !== 'matching' &&
      !occdMigrationFileMatches(stagedBlobPath(root, manifest, upload), upload)
    ) {
      throw new Error(`occd_migration_blob_digest_mismatch:${label}`)
    }
  }
}

/** Verified staged files; call after assertOCCdMigrationBlobsReady in the same synchronous turn. */
export function stagedOCCdMigrationBlobFiles(
  manifest: OCCdMigrationManifest,
  root: string
): { descriptor: OCCdMigrationBlobDescriptor; path: string }[] {
  return stagedBlobDescriptors(root, manifest).map((descriptor) => ({
    descriptor,
    path: stagedBlobPath(root, manifest, descriptor)
  }))
}

/** Reject missing or extra blobs, including leftovers from another capture. */
export function assertOCCdMigrationBlobSetMatches(
  manifest: OCCdMigrationManifest,
  root: string,
  expected: readonly OCCdMigrationBlobDescriptor[]
): void {
  assertOCCdMigrationBlobSet(expected)
  const wanted = new Map(expected.map((entry) => [occdMigrationBlobIdentity(entry), entry]))
  const staged = stagedBlobDescriptors(root, manifest)
  const stagedIds = new Set(staged.map(occdMigrationBlobIdentity))
  for (const descriptor of staged) {
    const match = wanted.get(occdMigrationBlobIdentity(descriptor))
    if (!match || !sameOCCdMigrationBlob(match, descriptor)) {
      throw blobSetMismatch(descriptor)
    }
  }
  for (const identity of receivedBlobIdentities(root, manifest)) {
    if (!wanted.has(identity)) {
      throw new Error('occd_migration_blob_set_mismatch')
    }
  }
  for (const descriptor of expected) {
    // Previous commit attempts may have moved these bytes to received.
    if (
      !stagedIds.has(occdMigrationBlobIdentity(descriptor)) &&
      inspectReceivedBlob(root, manifest, descriptor) !== 'matching'
    ) {
      throw blobSetMismatch(descriptor)
    }
  }
}

/** Call assertOCCdMigrationBlobsReady in the same synchronous turn so no chunk can change verified bytes. */
export function commitOCCdMigrationBlobs(manifest: OCCdMigrationManifest, root: string): void {
  const directories = new Set<string>()
  for (const descriptor of stagedBlobDescriptors(root, manifest)) {
    const finalPath = getOCCdMigrationReceivedBlobPath(root, manifest, descriptor)
    ensureOCCdMigrationDirectory(dirname(finalPath))
    linkOCCdMigrationStagedFile({
      stagedPath: stagedBlobPath(root, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `occd_migration_blob_destination_conflict:${descriptor.blobKind}:${descriptor.key}`
    })
    directories.add(dirname(finalPath))
  }
  for (const directory of directories) {
    syncDirectoryDurablySync(directory)
  }
  removeOCCdMigrationStagingDirectory(root, manifest)
}

/** Also remove blobs moved by a commit that never landed. */
export function abortOCCdMigrationBlobs(manifest: OCCdMigrationManifest, root: string): void {
  removeOCCdMigrationStagingDirectory(root, manifest)
  rmSync(receivedBlobsDirectory(root, manifest), { recursive: true, force: true })
}

export function pruneOCCdMigrationBlobStaging(
  stagedManifests: readonly OCCdMigrationManifest[],
  committedMigrations: readonly OCCdMigrationRequestIdentity[],
  root: string
): void {
  pruneOCCdMigrationStagingDirectories(root, stagedManifests)
  pruneOCCdMigrationKeyedDirectories(join(root, RECEIVED_DIRECTORY), [
    ...stagedManifests,
    ...committedMigrations
  ])
}

function blobSetMismatch(descriptor: OCCdMigrationBlobDescriptor): Error {
  return new Error(`occd_migration_blob_set_mismatch:${descriptor.blobKind}:${descriptor.key}`)
}

function receivedBlobIdentities(root: string, manifest: OCCdMigrationManifest): string[] {
  const received = receivedBlobsDirectory(root, manifest)
  return OCCD_MIGRATION_BLOB_KINDS.flatMap((blobKind) =>
    readDirectory(join(received, blobKind)).map((key) =>
      occdMigrationBlobIdentity({ blobKind, key })
    )
  )
}

function stagedBlobDescriptors(
  root: string,
  manifest: OCCdMigrationManifest
): OCCdMigrationBlobDescriptor[] {
  const staging = occdMigrationStagingDirectory(root, manifest)
  const descriptors: OCCdMigrationBlobDescriptor[] = []
  for (const blobKind of OCCD_MIGRATION_BLOB_KINDS) {
    for (const name of readDirectory(join(staging, blobKind))) {
      const match = STAGED_BLOB_NAME.exec(name)
      if (!match) {
        continue
      }
      try {
        descriptors.push(
          parseOCCdMigrationBlobDescriptor({
            blobKind,
            key: match[1],
            sha256: match[2],
            byteLength: Number(match[3])
          })
        )
      } catch {
        // Foreign names cannot belong to the staged set.
      }
    }
  }
  return descriptors
}

function readDirectory(path: string): string[] {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}

function inspectReceivedBlob(
  root: string,
  manifest: OCCdMigrationManifest,
  descriptor: OCCdMigrationBlobDescriptor
): 'absent' | 'matching' | 'conflict' {
  return inspectOCCdMigrationFinalFile(
    getOCCdMigrationReceivedBlobPath(root, manifest, descriptor),
    descriptor
  )
}

function receivedBlobsDirectory(root: string, manifest: OCCdMigrationRequestIdentity): string {
  return join(root, RECEIVED_DIRECTORY, occdMigrationStagingKey(manifest))
}

function stagedBlobPath(
  root: string,
  manifest: OCCdMigrationManifest,
  descriptor: OCCdMigrationBlobDescriptor
): string {
  return join(
    occdMigrationStagingDirectory(root, manifest),
    descriptor.blobKind,
    `${descriptor.key}.${descriptor.sha256}.${descriptor.byteLength}.part`
  )
}
