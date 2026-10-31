import type { z } from 'zod'
import {
  OCCdMigrationCatalogParams,
  OCCdMigrationCatalogReferenceParams,
  OCCdMigrationCommitCatalogParams
} from '../../../../shared/rpc-contract/occd-migration-params'
import { parseOCCdMigrationManifest } from '../../../../shared/occd-migration/occd-migration-manifest-validation'
import { OCCdMigrationSnapshotChunkRequestSchema } from '../../../../shared/occd-migration/occd-migration-scrollback'
import { OCCdMigrationBlobChunkRequestSchema } from '../../../../shared/occd-migration/occd-migration-blob-transfer'
import { assertOCCdMigrationManifestDigest } from '../../../occd/occd-migration-manifest-digest'
import { assertOCCdMigrationSourceServedHere } from '../../../occd/occd-migration-wsl-destination'
import { defineMethod, type RpcContext } from '../core'

export const OCCD_MIGRATION_METHODS = [
  defineMethod({
    name: 'occd.migration.stageCatalog',
    permission: 'host-admin',
    params: OCCdMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageOCCdMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'occd.migration.commitCatalog',
    permission: 'host-admin',
    params: OCCdMigrationCommitCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.commitStagedOCCdMigrationCatalog(migrationManifest(params), {
        signal: context.signal,
        ...(params.expectedBlobs ? { expectedBlobs: params.expectedBlobs } : {})
      })
    }
  }),
  defineMethod({
    name: 'occd.migration.stageSnapshotChunk',
    permission: 'host-admin',
    params: OCCdMigrationSnapshotChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageOCCdMigrationSnapshotChunk(params)
    }
  }),
  // A separate method, not a field on stageSnapshotChunk: an older host would strip the field and
  // stage the bytes as a snapshot.
  defineMethod({
    name: 'occd.migration.stageBlobChunk',
    permission: 'host-admin',
    params: OCCdMigrationBlobChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageOCCdMigrationBlobChunk(params)
    }
  }),
  defineMethod({
    name: 'occd.migration.abortCatalog',
    permission: 'host-admin',
    params: OCCdMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedOCCdMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  // Why a reference: a source fenced on a manifest no request can carry must still be releasable.
  defineMethod({
    name: 'occd.migration.abortCatalogByReference',
    permission: 'host-admin',
    params: OCCdMigrationCatalogReferenceParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedOCCdMigrationCatalogByReference(params, {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'occd.migration.catalogState',
    permission: 'host-admin',
    params: OCCdMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.getOCCdMigrationCatalogState(migrationManifest(params))
    }
  })
]

function migrationManifest(params: z.infer<typeof OCCdMigrationCatalogParams>) {
  const manifest = parseOCCdMigrationManifest(params.manifest)
  // Raw, not parsed: parsing drops fields this host predates, which a newer client signed.
  assertOCCdMigrationManifestDigest(params.manifest)
  assertOCCdMigrationSourceServedHere(manifest.source)
  return manifest
}

function requireMigrationRuntimeClient(context: RpcContext): void {
  if (context.clientKind !== 'runtime' || !context.pairedDeviceId) {
    throw new Error('occd_migration_runtime_client_required')
  }
}
