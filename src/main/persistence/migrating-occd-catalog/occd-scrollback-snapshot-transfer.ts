import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OCCdMigrationManifest } from '../../../shared/occd-migration/occd-migration-manifest'
import {
  decodeOCCdMigrationSnapshotChunk,
  type OCCdMigrationSnapshotChunkRequest,
  type OCCdMigrationSnapshotChunkResult,
  type OCCdMigrationSnapshotUploadState,
  type OCCdMigrationTerminalScrollbackSnapshot
} from '../../../shared/occd-migration/occd-migration-scrollback'
import { syncDirectoryDurablySync } from '../../durable-file-write'
import {
  getTerminalScrollbackSnapshotPath,
  getTerminalScrollbackSnapshotRoot,
  type TerminalScrollbackSnapshotStorage
} from '../../terminal-scrollback-snapshots'
import {
  appendOCCdMigrationStagedChunk,
  ensureOCCdMigrationDirectory,
  inspectOCCdMigrationFinalFile,
  linkOCCdMigrationStagedFile,
  occdMigrationFileMatches,
  occdMigrationStagedFileSize,
  occdMigrationStagingDirectory,
  pruneOCCdMigrationStagingDirectories,
  removeOCCdMigrationStagingDirectory,
  requireStagedOCCdMigrationManifest
} from './occd-migration-staged-file'

/** Only the staged manifest's snapshots may receive chunks; retried ranges must match. */
export function stageOCCdMigrationSnapshotChunk(args: {
  stagedManifest: OCCdMigrationManifest | null
  storage: TerminalScrollbackSnapshotStorage
  request: OCCdMigrationSnapshotChunkRequest
}): OCCdMigrationSnapshotChunkResult {
  const manifest = requireStagedOCCdMigrationManifest(
    args.stagedManifest,
    args.request,
    'occd_migration_snapshot_catalog_not_staged'
  )
  const descriptor = requireDescriptor(manifest, args.request.ref)
  const bytes = decodeOCCdMigrationSnapshotChunk(args.request.bytesBase64)
  ensureOCCdMigrationDirectory(stagingDirectory(args.storage, manifest))
  const acknowledgedOffset = appendOCCdMigrationStagedChunk({
    channel: 'snapshot',
    path: stagedSnapshotPath(args.storage, manifest, descriptor),
    offset: args.request.offset,
    bytes,
    byteLength: descriptor.byteLength
  })
  return {
    migrationId: args.request.migrationId,
    manifestSha256: args.request.manifestSha256,
    ref: args.request.ref,
    acknowledgedOffset
  }
}

export function inspectOCCdMigrationSnapshotUploads(
  manifest: OCCdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): OCCdMigrationSnapshotUploadState[] | undefined {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  if (snapshots.length === 0) {
    return undefined
  }
  return snapshots.map((descriptor) => ({
    ...descriptor,
    receivedBytes:
      inspectFinalSnapshot(storage, descriptor) === 'matching'
        ? descriptor.byteLength
        : occdMigrationStagedFileSize(
            stagedSnapshotPath(storage, manifest, descriptor),
            descriptor.byteLength
          )
  }))
}

export function assertOCCdMigrationSnapshotsReady(
  manifest: OCCdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  for (const upload of inspectOCCdMigrationSnapshotUploads(manifest, storage) ?? []) {
    const finalStatus = inspectFinalSnapshot(storage, upload)
    if (finalStatus === 'conflict') {
      throw new Error(`occd_migration_snapshot_destination_conflict:${upload.ref}`)
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new Error(`occd_migration_snapshot_incomplete:${upload.ref}`)
    }
    const path =
      finalStatus === 'matching'
        ? getTerminalScrollbackSnapshotPath(upload.ref, storage)
        : stagedSnapshotPath(storage, manifest, upload)
    if (!path || !occdMigrationFileMatches(path, upload)) {
      throw new Error(`occd_migration_snapshot_digest_mismatch:${upload.ref}`)
    }
  }
}

export function commitOCCdMigrationSnapshots(
  manifest: OCCdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  const snapshots = manifest.payload.dormantState?.terminalScrollbackSnapshots ?? []
  assertOCCdMigrationSnapshotsReady(manifest, storage)
  const root = getTerminalScrollbackSnapshotRoot(storage)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  for (const descriptor of snapshots) {
    const finalPath = getTerminalScrollbackSnapshotPath(descriptor.ref, storage)
    if (!finalPath) {
      throw new Error('occd_migration_snapshot_ref_invalid')
    }
    linkOCCdMigrationStagedFile({
      stagedPath: stagedSnapshotPath(storage, manifest, descriptor),
      finalPath,
      expected: descriptor,
      conflictError: `occd_migration_snapshot_destination_conflict:${descriptor.ref}`
    })
  }
  syncDirectoryDurablySync(root)
  removeOCCdMigrationStagingDirectory(root, manifest)
}

export function abortOCCdMigrationSnapshots(
  manifest: OCCdMigrationManifest,
  storage: TerminalScrollbackSnapshotStorage
): void {
  removeOCCdMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

export function pruneOCCdMigrationSnapshotStaging(
  stagedManifests: readonly OCCdMigrationManifest[],
  storage: TerminalScrollbackSnapshotStorage
): void {
  pruneOCCdMigrationStagingDirectories(getTerminalScrollbackSnapshotRoot(storage), stagedManifests)
}

function requireDescriptor(
  manifest: OCCdMigrationManifest,
  ref: string
): OCCdMigrationTerminalScrollbackSnapshot {
  const descriptor = manifest.payload.dormantState?.terminalScrollbackSnapshots?.find(
    (entry) => entry.ref === ref
  )
  if (!descriptor) {
    throw new Error('occd_migration_snapshot_unknown')
  }
  return descriptor
}

function inspectFinalSnapshot(
  storage: TerminalScrollbackSnapshotStorage,
  descriptor: OCCdMigrationTerminalScrollbackSnapshot
): 'absent' | 'matching' | 'conflict' {
  return inspectOCCdMigrationFinalFile(
    getTerminalScrollbackSnapshotPath(descriptor.ref, storage),
    descriptor
  )
}

function stagingDirectory(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: OCCdMigrationManifest
): string {
  return occdMigrationStagingDirectory(getTerminalScrollbackSnapshotRoot(storage), manifest)
}

function stagedSnapshotPath(
  storage: TerminalScrollbackSnapshotStorage,
  manifest: OCCdMigrationManifest,
  descriptor: OCCdMigrationTerminalScrollbackSnapshot
): string {
  return join(stagingDirectory(storage, manifest), `${descriptor.ref}.${descriptor.sha256}.part`)
}
