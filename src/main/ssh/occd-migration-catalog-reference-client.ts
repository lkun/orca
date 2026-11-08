import { parseOCCdMigrationCatalogReferenceAbortResult } from '../../shared/occd-migration/occd-migration-catalog-state'
import type {
  OCCdMigrationCatalogReference,
  OCCdMigrationCatalogReferenceAbortResult
} from '../../shared/occd-migration/occd-migration-manifest'
import { OCCD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY } from '../../shared/occd-runtime-capabilities'
import { parsePairingCode } from '../../shared/remote-runtime/pairing/pairing'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import {
  OCCD_MIGRATION_DESTINATION_UNSUPPORTED,
  sendSupportedMigrationRequest,
  type CatalogRequestOptions
} from './occd-migration-catalog-client'

/** Unlike migration-unsupported, this refusal cannot prove no earlier stage exists. */
export const OCCD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED =
  'occd_migration_destination_abort_by_reference_unsupported:Update OCC on this host to cancel this move.'

/** Abort by manifest identity when the full request cannot fit the sealed frame. */
export async function abortRemoteOCCdMigrationCatalogByReference(
  pairingCode: string,
  manifest: OCCdMigrationCatalogReference,
  options: CatalogRequestOptions = {}
): Promise<OCCdMigrationCatalogReferenceAbortResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('occd_migration_pairing_code_invalid')
  }
  let supportsReference = false
  let response: RuntimeRpcResponse<unknown>
  try {
    response = await sendSupportedMigrationRequest(
      pairing,
      'occd.migration.abortCatalogByReference',
      { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 },
      options,
      false,
      null,
      (capabilities) => {
        supportsReference = capabilities.includes(
          OCCD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY
        )
        if (!supportsReference) {
          throw new Error(OCCD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
        }
      }
    )
  } catch (error) {
    // A missing method on a host that advertised it proves nothing about what it staged.
    if (
      supportsReference &&
      error instanceof Error &&
      error.message === OCCD_MIGRATION_DESTINATION_UNSUPPORTED
    ) {
      throw new Error(OCCD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
    }
    throw error
  }
  if (!response.ok) {
    throw new Error(`occd_migration_abort_failed:${response.error.message}`)
  }
  return parseOCCdMigrationCatalogReferenceAbortResult(response.result, manifest)
}
