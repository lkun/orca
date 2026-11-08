import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultWorkspaceSession } from '../../../shared/constants'
import { OCCD_MIGRATION_MANIFEST_VERSION } from '../../../shared/occd-migration/occd-migration-manifest-validation'
import type { OCCdMigrationManifest } from '../../../shared/occd-migration/occd-migration-manifest'
import type {
  OCCdMigrationSnapshotChunkRequest,
  OCCdMigrationTerminalScrollbackSnapshot
} from '../../../shared/occd-migration/occd-migration-scrollback'
import {
  getTerminalScrollbackSnapshotPath,
  type TerminalScrollbackSnapshotStorage
} from '../../pty/scrollback/terminal-scrollback-snapshots'
import {
  abortOCCdMigrationSnapshots,
  assertOCCdMigrationSnapshotsReady,
  commitOCCdMigrationSnapshots,
  inspectOCCdMigrationSnapshotUploads,
  pruneOCCdMigrationSnapshotStaging,
  stageOCCdMigrationSnapshotChunk
} from './occd-scrollback-snapshot-transfer'

let root: string
let storage: TerminalScrollbackSnapshotStorage

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'occd-migration-snapshots-'))
  storage = { snapshotRoot: join(root, 'terminal-scrollback') }
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('occd scrollback snapshot transfer', () => {
  it('resumes from staged byte length and accepts only exact idempotent retries', () => {
    const bytes = Buffer.from('first line\nmultibyte: 🐋\nlast line', 'utf8')
    const descriptor = snapshot('1', 'tab-1', 'leaf-1', bytes)
    const manifest = migrationManifest('resume', [descriptor])
    const state = stagedState(manifest)
    const first = bytes.subarray(0, 11)

    expect(stage(state, manifest, descriptor, 0, first).acknowledgedOffset).toBe(first.length)
    expect(inspectOCCdMigrationSnapshotUploads(manifest, storage)?.[0]?.receivedBytes).toBe(
      first.length
    )
    expect(stage(state, manifest, descriptor, 0, first).acknowledgedOffset).toBe(first.length)
    expect(() => stage(state, manifest, descriptor, 0, Buffer.from('different!!'))).toThrow(
      'occd_migration_snapshot_retry_mismatch'
    )
    expect(() => stage(state, manifest, descriptor, first.length + 1, Buffer.from('x'))).toThrow(
      'occd_migration_snapshot_offset_invalid'
    )

    stage(state, manifest, descriptor, first.length, bytes.subarray(first.length))
    assertOCCdMigrationSnapshotsReady(manifest, storage)
    commitOCCdMigrationSnapshots(manifest, storage)
    expect(readFinal(descriptor)).toEqual(bytes)
  })

  it('refuses incomplete and digest-mismatched staged bytes', () => {
    const bytes = Buffer.from('expected bytes', 'utf8')
    const descriptor = snapshot('2', 'tab-2', 'leaf-2', bytes)
    const manifest = migrationManifest('refuse', [descriptor])
    const state = stagedState(manifest)

    stage(state, manifest, descriptor, 0, bytes.subarray(0, 4))
    expect(() => assertOCCdMigrationSnapshotsReady(manifest, storage)).toThrow(
      'occd_migration_snapshot_incomplete'
    )
    stage(state, manifest, descriptor, 4, Buffer.alloc(bytes.length - 4, 0x78))
    expect(() => assertOCCdMigrationSnapshotsReady(manifest, storage)).toThrow(
      'occd_migration_snapshot_digest_mismatch'
    )
    expect(readFinal(descriptor)).toBeNull()
  })

  it('rejects a same-ref content conflict before materializing any snapshot', () => {
    const firstBytes = Buffer.from('first snapshot', 'utf8')
    const secondBytes = Buffer.from('second snapshot', 'utf8')
    const first = snapshot('4', 'tab-4', 'leaf-4', firstBytes)
    const second = snapshot('5', 'tab-5', 'leaf-5', secondBytes)
    const manifest = migrationManifest('conflict', [first, second])
    const state = stagedState(manifest)
    stage(state, manifest, first, 0, firstBytes)
    stage(state, manifest, second, 0, secondBytes)
    writeFinal(second, Buffer.alloc(secondBytes.length, 0x78))

    expect(() => commitOCCdMigrationSnapshots(manifest, storage)).toThrow(
      `occd_migration_snapshot_destination_conflict:${second.ref}`
    )
    expect(readFinal(first)).toBeNull()
    expect(readFinal(second)).toEqual(Buffer.alloc(secondBytes.length, 0x78))
  })

  it('removes only the selected staging tree and prunes unjournaled trees', () => {
    const bytes = Buffer.from('staged bytes', 'utf8')
    const firstDescriptor = snapshot('6', 'tab-6', 'leaf-6', bytes)
    const secondDescriptor = snapshot('7', 'tab-7', 'leaf-7', bytes)
    const first = migrationManifest('abort-first', [firstDescriptor])
    const second = migrationManifest('retain-second', [secondDescriptor])
    const state = stagedState(first, second)
    stage(state, first, firstDescriptor, 0, bytes)
    stage(state, second, secondDescriptor, 0, bytes)

    abortOCCdMigrationSnapshots(first, storage)
    expect(inspectOCCdMigrationSnapshotUploads(first, storage)?.[0]?.receivedBytes).toBe(0)
    expect(inspectOCCdMigrationSnapshotUploads(second, storage)?.[0]?.receivedBytes).toBe(
      bytes.length
    )
    pruneOCCdMigrationSnapshotStaging(
      state.filter((entry) => entry.migrationId !== second.migrationId),
      storage
    )
    expect(inspectOCCdMigrationSnapshotUploads(second, storage)?.[0]?.receivedBytes).toBe(0)
  })
})

function snapshot(
  suffix: string,
  tabId: string,
  leafId: string,
  bytes: Buffer
): OCCdMigrationTerminalScrollbackSnapshot {
  return {
    tabId,
    leafId,
    ref: `v1-${suffix.repeat(32)}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length
  }
}

function migrationManifest(
  migrationId: string,
  snapshots: OCCdMigrationTerminalScrollbackSnapshot[]
): OCCdMigrationManifest {
  const workspaceSession = getDefaultWorkspaceSession()
  workspaceSession.terminalLayoutsByTabId = Object.fromEntries(
    snapshots.map((entry) => [
      entry.tabId,
      {
        root: { type: 'leaf' as const, leafId: entry.leafId },
        activeLeafId: entry.leafId,
        expandedLeafId: null,
        scrollbackRefsByLeafId: { [entry.leafId]: entry.ref }
      }
    ])
  )
  return {
    version: OCCD_MIGRATION_MANIFEST_VERSION,
    migrationId,
    createdAt: '2026-08-30T12:00:00.000Z',
    source: { sshTargetId: 'source', sshTargetGeneration: 1, targetLabel: 'Source' },
    payload: {
      repositories: [],
      projectGroups: [],
      folderWorkspaces: [],
      dormantState: {
        version: 1,
        worktreeMeta: [],
        worktreeLineage: [],
        workspaceLineage: [],
        sparsePresets: [],
        retiredWorktreeNames: [],
        retiredWorktreeNamespaces: [],
        workspaceSession,
        terminalScrollbackSnapshots: snapshots
      }
    },
    manifestSha256: 'a'.repeat(64)
  }
}

function stagedState(...manifests: OCCdMigrationManifest[]): OCCdMigrationManifest[] {
  return manifests
}

function stage(
  state: OCCdMigrationManifest[],
  manifest: OCCdMigrationManifest,
  descriptor: OCCdMigrationTerminalScrollbackSnapshot,
  offset: number,
  bytes: Buffer
) {
  const request: OCCdMigrationSnapshotChunkRequest = {
    migrationId: manifest.migrationId,
    manifestSha256: manifest.manifestSha256,
    ref: descriptor.ref,
    offset,
    bytesBase64: bytes.toString('base64')
  }
  const stagedManifest = state.find((entry) => entry.migrationId === manifest.migrationId) ?? null
  return stageOCCdMigrationSnapshotChunk({ stagedManifest, storage, request })
}

function writeFinal(descriptor: OCCdMigrationTerminalScrollbackSnapshot, bytes: Buffer): void {
  const path = getTerminalScrollbackSnapshotPath(descriptor.ref, storage)
  if (!path) {
    throw new Error('expected snapshot path')
  }
  if (!storage.snapshotRoot) {
    throw new Error('expected snapshot root')
  }
  mkdirSync(storage.snapshotRoot, { recursive: true })
  writeFileSync(path, bytes)
}

function readFinal(descriptor: OCCdMigrationTerminalScrollbackSnapshot): Buffer | null {
  const path = getTerminalScrollbackSnapshotPath(descriptor.ref, storage)
  return path && existsSync(path) ? readFileSync(path) : null
}
