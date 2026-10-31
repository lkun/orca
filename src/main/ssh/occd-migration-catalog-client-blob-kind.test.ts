import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OCCdMigrationBlobChunkRequest,
  OCCdMigrationBlobDescriptor
} from '../../shared/occd-migration/occd-migration-blob-transfer'
import { OCCD_MIGRATION_MANIFEST_VERSION } from '../../shared/occd-migration/occd-migration-manifest-validation'
import type { OCCdMigrationManifest } from '../../shared/occd-migration/occd-migration-manifest'
import {
  OCCD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
  OCCD_MIGRATION_CATALOG_RUNTIME_CAPABILITY
} from '../../shared/occd-runtime-capabilities'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'

const sendRequest = vi.hoisted(() => vi.fn())
const status = vi.hoisted((): { capabilities: string[] } => ({ capabilities: [] }))
vi.mock('../../shared/remote-runtime/remote-runtime-client', () => ({
  sendRemoteRuntimeRequestWithStatusPreflight: async (
    pairing: unknown,
    method: string,
    params: unknown,
    _timeoutMs: number,
    validate: (response: unknown) => void
  ) => {
    validate({
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: { capabilities: status.capabilities }
    })
    return sendRequest(pairing, method, params)
  }
}))

const { commitRemoteOCCdMigrationCatalog, stageRemoteOCCdMigrationBlobChunk } =
  await import('./occd-migration-catalog-client')

const pairingCode = encodePairingOffer({
  v: PAIRING_OFFER_VERSION,
  endpoint: 'ws://127.0.0.1:46768/runtime',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key',
  pairedDeviceId: 'paired-desktop'
})

const request: OCCdMigrationBlobChunkRequest = {
  migrationId: 'migration-blob',
  manifestSha256: 'a'.repeat(64),
  blob: {
    blobKind: 'shell-history',
    key: `${'b'.repeat(16)}-zsh`,
    sha256: 'c'.repeat(64),
    byteLength: 3
  },
  offset: 0,
  bytesBase64: 'YWJj'
}

beforeEach(() => {
  vi.clearAllMocks()
  sendRequest.mockResolvedValue({
    ok: true,
    _meta: { runtimeId: 'runtime' },
    result: {
      migrationId: request.migrationId,
      manifestSha256: request.manifestSha256,
      blobKind: 'shell-history',
      key: request.blob.key,
      receivedBytes: 3
    }
  })
})

describe('occd migration blob chunk capability gate', () => {
  it.each([
    ['an older destination', [OCCD_MIGRATION_CATALOG_RUNTIME_CAPABILITY]],
    [
      'a destination with only the channel',
      [OCCD_MIGRATION_CATALOG_RUNTIME_CAPABILITY, OCCD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY]
    ]
  ])('never sends a blob to %s, and names the kind', async (_, capabilities) => {
    status.capabilities = capabilities
    await expect(stageRemoteOCCdMigrationBlobChunk(pairingCode, request)).rejects.toThrow(
      /^occd_migration_destination_blob_kind_unsupported:shell-history:/
    )
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('sends through its own method once the destination installs the kind', async () => {
    status.capabilities = [
      OCCD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
      OCCD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
      'occd.migration-blob.shell-history.v1'
    ]
    await expect(stageRemoteOCCdMigrationBlobChunk(pairingCode, request)).resolves.toMatchObject({
      receivedBytes: 3
    })
    expect(sendRequest).toHaveBeenCalledWith(
      expect.anything(),
      'occd.migration.stageBlobChunk',
      request
    )
  })
})

describe('occd migration commit names its blob set', () => {
  const manifest: OCCdMigrationManifest = {
    version: OCCD_MIGRATION_MANIFEST_VERSION,
    migrationId: request.migrationId,
    createdAt: '2026-08-30T12:00:00.000Z',
    source: {
      sshTargetId: 'source',
      sshTargetGeneration: 1,
      targetLabel: 'Source'
    },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
    manifestSha256: request.manifestSha256
  }
  const expectedBlobs: OCCdMigrationBlobDescriptor[] = [request.blob]
  const installing = [
    OCCD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
    OCCD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
    'occd.migration-blob.shell-history.v1'
  ]

  beforeEach(() => {
    sendRequest.mockResolvedValue({
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: {
        state: 'staged',
        migrationId: manifest.migrationId,
        manifestSha256: manifest.manifestSha256,
        stagedAt: '2026-08-30T12:00:00.000Z'
      }
    })
  })

  it('sends exactly `{ manifest }` when the move carried no blobs, even to a blob host', async () => {
    for (const capabilities of [[OCCD_MIGRATION_CATALOG_RUNTIME_CAPABILITY], installing]) {
      status.capabilities = capabilities
      await commitRemoteOCCdMigrationCatalog(pairingCode, manifest)
      await commitRemoteOCCdMigrationCatalog(pairingCode, manifest, {
        expectedBlobs: []
      })
      expect(sendRequest).toHaveBeenLastCalledWith(
        expect.anything(),
        'occd.migration.commitCatalog',
        { manifest }
      )
    }
  })

  it('names the blobs to a destination with the channel, and never to one without', async () => {
    status.capabilities = installing
    await commitRemoteOCCdMigrationCatalog(pairingCode, manifest, {
      expectedBlobs
    })
    expect(sendRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      'occd.migration.commitCatalog',
      { manifest, expectedBlobs }
    )

    sendRequest.mockClear()
    status.capabilities = [OCCD_MIGRATION_CATALOG_RUNTIME_CAPABILITY]
    await expect(
      commitRemoteOCCdMigrationCatalog(pairingCode, manifest, {
        expectedBlobs
      })
    ).rejects.toThrow(/^occd_migration_destination_blob_kind_unsupported:shell-history:/)
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
