import { describe, expect, it, vi } from 'vitest'
import { OCCD_MIGRATION_MANIFEST_VERSION } from '../../../../shared/occd-migration/occd-migration-manifest-validation'
import type { OCCdMigrationManifest } from '../../../../shared/occd-migration/occd-migration-manifest'
import { computeOCCdMigrationManifestSha256 } from '../../../occd/occd-migration-manifest-digest'
import type { OCCRuntimeService } from '../../occ-runtime'
import { eraseRpcMethods, isStreamingMethod, type RpcContext } from '../core'
import { ALL_RPC_METHODS } from './index'
import { OCCD_MIGRATION_METHODS } from './occd-migration'

function manifest(): OCCdMigrationManifest {
  const unsigned = {
    version: OCCD_MIGRATION_MANIFEST_VERSION,
    migrationId: 'migration-1',
    createdAt: '2026-08-30T12:00:00.000Z',
    source: {
      sshTargetId: 'ssh-prod',
      sshTargetGeneration: 7,
      targetLabel: 'Production'
    },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] }
  }
  return {
    ...unsigned,
    manifestSha256: computeOCCdMigrationManifestSha256(unsigned)
  }
}

const MIGRATION_METHOD_NAMES = [
  'occd.migration.stageCatalog',
  'occd.migration.commitCatalog',
  'occd.migration.stageSnapshotChunk',
  'occd.migration.stageBlobChunk',
  'occd.migration.abortCatalog',
  'occd.migration.abortCatalogByReference',
  'occd.migration.catalogState'
] as const

function migrationMethod(
  name: (typeof MIGRATION_METHOD_NAMES)[number] = MIGRATION_METHOD_NAMES[0]
) {
  const method = eraseRpcMethods(OCCD_MIGRATION_METHODS).find(
    (candidate) => candidate.name === name
  )
  if (!method || isStreamingMethod(method)) {
    throw new Error(`Missing or invalid ${name} method`)
  }
  return method
}

function context(
  stageOCCdMigrationCatalog: ReturnType<typeof vi.fn>,
  overrides: Partial<RpcContext> = {},
  runtimeOverrides: Record<string, unknown> = {}
): RpcContext {
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the migration methods call only the runtime members stubbed here.
    runtime: { stageOCCdMigrationCatalog, ...runtimeOverrides } as unknown as OCCRuntimeService,
    clientKind: 'runtime',
    pairedDeviceId: 'paired-desktop',
    ...overrides
  }
}

describe('occd migration RPC', () => {
  it('registers every staged-cutover method exactly once', () => {
    for (const name of MIGRATION_METHOD_NAMES) {
      expect(ALL_RPC_METHODS.filter((method) => method.name === name)).toHaveLength(1)
    }
  })

  it('stages, commits, aborts, and reconciles through the authenticated runtime client', async () => {
    const input = manifest()
    const signal = new AbortController().signal
    const stage = vi.fn().mockResolvedValue({ state: 'staged' })
    const commit = vi.fn().mockResolvedValue({ state: 'committed' })
    const snapshot = vi.fn().mockReturnValue({ acknowledgedOffset: 1 })
    const abort = vi.fn().mockResolvedValue({ state: 'absent', aborted: true })
    const state = vi.fn().mockReturnValue({ state: 'staged' })
    const runtime = {
      stageOCCdMigrationCatalog: stage,
      commitStagedOCCdMigrationCatalog: commit,
      stageOCCdMigrationSnapshotChunk: snapshot,
      abortStagedOCCdMigrationCatalog: abort,
      getOCCdMigrationCatalogState: state
    }
    const caller = context(vi.fn(), { signal }, runtime)

    await expect(
      migrationMethod('occd.migration.stageCatalog').handler({ manifest: input }, caller)
    ).resolves.toEqual({ state: 'staged' })
    await expect(
      migrationMethod('occd.migration.commitCatalog').handler({ manifest: input }, caller)
    ).resolves.toEqual({ state: 'committed' })
    const snapshotRequest = migrationSnapshotRequest(input)
    await expect(
      migrationMethod('occd.migration.stageSnapshotChunk').handler(snapshotRequest, caller)
    ).resolves.toEqual({ acknowledgedOffset: 1 })
    await expect(
      migrationMethod('occd.migration.abortCatalog').handler({ manifest: input }, caller)
    ).resolves.toEqual({ state: 'absent', aborted: true })
    await expect(
      migrationMethod('occd.migration.catalogState').handler({ manifest: input }, caller)
    ).resolves.toEqual({ state: 'staged' })
    expect(stage).toHaveBeenCalledWith(input, { signal })
    expect(commit).toHaveBeenCalledWith(input, { signal })
    expect(snapshot).toHaveBeenCalledWith(snapshotRequest)
    expect(abort).toHaveBeenCalledWith(input, { signal })
    expect(state).toHaveBeenCalledWith(input)
  })

  it.each([
    ['mobile client', { clientKind: 'mobile', pairedDeviceId: 'paired-phone' }],
    ['unpaired runtime client', { clientKind: 'runtime', pairedDeviceId: undefined }],
    ['local caller', { clientKind: undefined, pairedDeviceId: undefined }]
  ] as const)('rejects a %s before any migration mutation', async (_label, caller) => {
    for (const name of MIGRATION_METHOD_NAMES) {
      const invoke = vi.fn()
      const method = migrationMethod(name)
      const runtimeMethod =
        name === 'occd.migration.stageCatalog'
          ? 'stageOCCdMigrationCatalog'
          : name === 'occd.migration.commitCatalog'
            ? 'commitStagedOCCdMigrationCatalog'
            : name === 'occd.migration.stageSnapshotChunk'
              ? 'stageOCCdMigrationSnapshotChunk'
              : name === 'occd.migration.stageBlobChunk'
                ? 'stageOCCdMigrationBlobChunk'
                : name === 'occd.migration.abortCatalog'
                  ? 'abortStagedOCCdMigrationCatalog'
                  : name === 'occd.migration.abortCatalogByReference'
                    ? 'abortStagedOCCdMigrationCatalogByReference'
                    : 'getOCCdMigrationCatalogState'

      await expect(
        method.handler(
          method.params?.parse(migrationMethodInput(name)),
          context(invoke, caller, { [runtimeMethod]: invoke })
        )
      ).rejects.toThrow('occd_migration_runtime_client_required')
      expect(invoke).not.toHaveBeenCalled()
    }
  })

  it('passes a named blob set to commit only when the sender sent one', async () => {
    const input = manifest()
    const commit = vi.fn().mockResolvedValue({ state: 'committed' })
    const caller = context(vi.fn(), {}, { commitStagedOCCdMigrationCatalog: commit })
    const method = migrationMethod('occd.migration.commitCatalog')
    const expectedBlobs = [
      {
        blobKind: 'shell-history',
        key: `${'a'.repeat(16)}-zsh`,
        sha256: 'b'.repeat(64),
        byteLength: 1
      }
    ]

    await method.handler(method.params?.parse({ manifest: input, expectedBlobs }), caller)
    expect(commit).toHaveBeenLastCalledWith(input, {
      signal: undefined,
      expectedBlobs
    })
    await method.handler(method.params?.parse({ manifest: input }), caller)
    expect(commit).toHaveBeenLastCalledWith(input, { signal: undefined })
    expect(
      method.params?.safeParse({
        manifest: input,
        expectedBlobs: [
          {
            ...expectedBlobs[0],
            blobKind: 'agent-session-records',
            key: 'con'
          }
        ]
      }).success
    ).toBe(false)
  })

  it('stages a blob chunk through its own method and refuses malformed descriptors', async () => {
    const input = manifest()
    const blob = vi.fn().mockReturnValue({ receivedBytes: 1 })
    const caller = context(vi.fn(), {}, { stageOCCdMigrationBlobChunk: blob })
    const method = migrationMethod('occd.migration.stageBlobChunk')
    const request = migrationBlobRequest(input)

    await expect(method.handler(method.params?.parse(request), caller)).resolves.toEqual({
      receivedBytes: 1
    })
    expect(blob).toHaveBeenCalledWith(request)
    for (const key of ['../escape', `${'A'.repeat(16)}-zsh`, `${'a'.repeat(16)}-pwsh`]) {
      expect(method.params?.safeParse(migrationBlobRequest(input, key)).success, key).toBe(false)
    }
    expect(
      method.params?.safeParse({ ...request, blob: { ...request.blob, blobKind: 'future-kind' } })
        .success
    ).toBe(false)
  })

  it('rejects malformed and tampered manifests before staging', async () => {
    const stageCatalog = vi.fn()
    const method = migrationMethod()
    const input = manifest()

    await expect(
      method.handler(
        method.params?.parse({ manifest: { ...input, manifestSha256: 'invalid' } }),
        context(stageCatalog)
      )
    ).rejects.toThrow('occd_migration_manifest_digest_invalid')
    await expect(
      method.handler(
        method.params?.parse({
          manifest: { ...input, source: { ...input.source, targetLabel: 'Tampered' } }
        }),
        context(stageCatalog)
      )
    ).rejects.toThrow('occd_migration_manifest_digest_mismatch')
    expect(stageCatalog).not.toHaveBeenCalled()
  })

  it('verifies a newer client signature over fields this host does not know', async () => {
    const stageCatalog = vi.fn()
    const method = migrationMethod()
    const { manifestSha256: _, ...known } = manifest()
    const unsigned = {
      ...known,
      futureField: { enabled: true },
      source: { ...known.source, futureSourceField: 'x' }
    }
    const signed = {
      ...unsigned,
      manifestSha256: computeOCCdMigrationManifestSha256(unsigned)
    }

    await method.handler(method.params?.parse({ manifest: signed }), context(stageCatalog))
    expect(stageCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ manifestSha256: signed.manifestSha256, source: known.source }),
      expect.anything()
    )
    await expect(
      method.handler(
        method.params?.parse({ manifest: { ...signed, futureField: { enabled: false } } }),
        context(stageCatalog)
      )
    ).rejects.toThrow('occd_migration_manifest_digest_mismatch')
    const { futureField: __, ...stripped } = signed
    await expect(
      method.handler(method.params?.parse({ manifest: stripped }), context(stageCatalog)),
      'a peer that drops a signed field'
    ).rejects.toThrow('occd_migration_manifest_digest_mismatch')
    expect(stageCatalog).toHaveBeenCalledTimes(1)
  })
})

function migrationSnapshotRequest(input: OCCdMigrationManifest) {
  return {
    migrationId: input.migrationId,
    manifestSha256: input.manifestSha256,
    ref: `v1-${'1'.repeat(32)}`,
    offset: 0,
    bytesBase64: 'YQ=='
  }
}

function migrationMethodInput(name: (typeof MIGRATION_METHOD_NAMES)[number]) {
  const input = manifest()
  if (name === 'occd.migration.stageBlobChunk') {
    return migrationBlobRequest(input)
  }
  if (name === 'occd.migration.abortCatalogByReference') {
    return { migrationId: input.migrationId, manifestSha256: input.manifestSha256 }
  }
  return name === 'occd.migration.stageSnapshotChunk'
    ? migrationSnapshotRequest(input)
    : { manifest: input }
}

function migrationBlobRequest(input: OCCdMigrationManifest, key = `${'a'.repeat(16)}-zsh`) {
  return {
    migrationId: input.migrationId,
    manifestSha256: input.manifestSha256,
    blob: { blobKind: 'shell-history', key, sha256: 'b'.repeat(64), byteLength: 1 },
    offset: 0,
    bytesBase64: 'YQ=='
  }
}
