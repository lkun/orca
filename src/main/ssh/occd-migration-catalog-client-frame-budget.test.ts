import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OCCdMigrationBlobDescriptor } from '../../shared/occd-migration/occd-migration-blob-transfer'
import type { OCCdMigrationManifest } from '../../shared/occd-migration/occd-migration-manifest'
import {
  MAX_OCCD_MIGRATION_MANIFEST_BYTES,
  OCCD_MIGRATION_MANIFEST_VERSION
} from '../../shared/occd-migration/occd-migration-manifest-validation'
import {
  OCCD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
  OCCD_MIGRATION_CATALOG_RUNTIME_CAPABILITY
} from '../../shared/occd-runtime-capabilities'
import { encodePairingOffer } from '../../shared/remote-runtime/pairing/pairing'
import { PAIRING_OFFER_VERSION } from '../../shared/remote-runtime/pairing/mobile-relay-pairing-offer'

const sendRequest = vi.hoisted(() => vi.fn())
const extraCapabilities = vi.hoisted((): string[] => [])
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
      result: {
        capabilities: [
          OCCD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
          OCCD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
          'occd.migration-blob.agent-session-records.v1',
          ...extraCapabilities
        ]
      }
    })
    return sendRequest(pairing, method, params)
  }
}))

const { commitRemoteOCCdMigrationCatalog, stageRemoteOCCdMigrationCatalog } =
  await import('./occd-migration-catalog-client')

const pairingCode = encodePairingOffer({
  v: PAIRING_OFFER_VERSION,
  endpoint: 'ws://127.0.0.1:46768/runtime',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key',
  pairedDeviceId: 'paired-desktop'
})

function manifestOfBytes(bytes: number): OCCdMigrationManifest {
  const withLabel = (targetLabel: string): OCCdMigrationManifest => ({
    version: OCCD_MIGRATION_MANIFEST_VERSION,
    migrationId: 'migration-frame',
    createdAt: '2026-10-18T12:00:00.000Z',
    source: { sshTargetId: 'source', sshTargetGeneration: 1, targetLabel },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
    manifestSha256: 'a'.repeat(64)
  })
  return withLabel('x'.repeat(bytes - JSON.stringify(withLabel('')).length))
}

const manyBlobs: OCCdMigrationBlobDescriptor[] = Array.from({ length: 200 }, (_, index) => ({
  blobKind: 'agent-session-records',
  key: `session-${index}-${'s'.repeat(64)}`,
  sha256: 'c'.repeat(64),
  byteLength: 1024
}))

beforeEach(() => {
  vi.clearAllMocks()
  extraCapabilities.length = 0
  sendRequest.mockResolvedValue({
    ok: true,
    _meta: { runtimeId: 'runtime' },
    result: {
      state: 'staged',
      migrationId: 'migration-frame',
      manifestSha256: 'a'.repeat(64),
      stagedAt: '2026-10-18T12:00:00.000Z'
    }
  })
})

describe("occd migration requests fit the host's sealed inbound frame", () => {
  it('refuses, unsent, a manifest at the validation cap: sealed, it overflows the 1 MiB frame', async () => {
    await expect(
      stageRemoteOCCdMigrationCatalog(
        pairingCode,
        manifestOfBytes(MAX_OCCD_MIGRATION_MANIFEST_BYTES)
      )
    ).rejects.toThrow(/\(occd_migration_manifest_too_large\)$/)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('refuses, unsent, a commit whose blob list pushes a fitting manifest past the frame', async () => {
    const manifest = manifestOfBytes(760 * 1024)
    await expect(
      commitRemoteOCCdMigrationCatalog(pairingCode, manifest, { expectedBlobs: manyBlobs })
    ).rejects.toThrow(/too large to move to its OCC server/)
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
