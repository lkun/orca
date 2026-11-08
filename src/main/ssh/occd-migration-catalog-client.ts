import { hasModernAutomationLaunchSetup } from '../../shared/automations/launch/automation-launch-setup'
import { automationCanonicalLaunchSetup } from '../../shared/automations/launch/automation-canonical-launch-setup'
import {
  AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY,
  AUTOMATION_EXTRA_AGENT_ARGS_RUNTIME_CAPABILITY
} from '../../shared/automations/automation-runtime-capabilities'
import { z } from 'zod'
import { pairedRuntimeConnectionFromOffer } from '../../shared/remote-runtime/pairing/paired-runtime-connection'
import {
  parseOCCdMigrationCatalogAbortResult,
  parseOCCdMigrationCatalogState
} from '../../shared/occd-migration/occd-migration-catalog-state'
import type {
  OCCdMigrationCatalogAbortResult,
  OCCdMigrationCatalogState,
  OCCdMigrationManifest
} from '../../shared/occd-migration/occd-migration-manifest'
import {
  parseOCCdMigrationSnapshotChunkResult,
  type OCCdMigrationSnapshotChunkRequest,
  type OCCdMigrationSnapshotChunkResult
} from '../../shared/occd-migration/occd-migration-scrollback'
import {
  findUnsupportedMigrationBlobKind,
  occdMigrationBlobKindUnsupportedBlocker,
  parseOCCdMigrationBlobChunkResult,
  type OCCdMigrationBlobChunkRequest,
  type OCCdMigrationBlobChunkResult,
  type OCCdMigrationBlobDescriptor
} from '../../shared/occd-migration/occd-migration-blob-transfer'
import { occdMigrationManifestBlobs } from '../../shared/occd-migration/occd-migration-automation-run-history'
import { parsePairingCode } from '../../shared/remote-runtime/pairing/pairing'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../shared/electron-remote-runtime-client-capabilities'
import { OCCD_MIGRATION_CATALOG_RUNTIME_CAPABILITY } from '../../shared/occd-runtime-capabilities'
import { sendRemoteRuntimeRequestWithStatusPreflight } from '../../shared/remote-runtime/remote-runtime-client'
import { assertOCCdMigrationRequestFits } from './occd-migration-manifest-export'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import { hasExtraAgentArgs } from '../../shared/agent-launch/startup/automation-extra-agent-args'
import { requiredOCCdMigrationSourceCapability } from '../../shared/occd-migration/occd-migration-source-kind'
import type { OCCdServerRepository } from './occd-migration-repository-link'

type OCCdCatalogMigrationOperation = 'abort' | 'commit' | 'stage' | 'state'

/** Missing capability/method is definite refusal; other failures require catalog re-read because a lost reply may hide staged state. */
export const OCCD_MIGRATION_DESTINATION_UNSUPPORTED = 'occd_migration_destination_unsupported'
/** Refuse older destinations that would silently strip extra agent arguments. */
export const OCCD_MIGRATION_DESTINATION_EXTRA_AGENT_ARGS_UNSUPPORTED =
  'occd_migration_destination_extra_agent_args_unsupported:Update OCC on this host to use extra arguments.'
/** Unsupported source kinds are refused before any staging request. */
export const OCCD_MIGRATION_DESTINATION_SOURCE_KIND_UNSUPPORTED =
  'occd_migration_destination_source_kind_unsupported:Update OCC on this host to move this project to it.'

export type CatalogRequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  expectedRuntimeId?: string
}

const METHOD_BY_OPERATION: Record<OCCdCatalogMigrationOperation, string> = {
  abort: 'occd.migration.abortCatalog',
  commit: 'occd.migration.commitCatalog',
  stage: 'occd.migration.stageCatalog',
  state: 'occd.migration.catalogState'
}

export function stageRemoteOCCdMigrationCatalog(
  pairingCode: string,
  manifest: OCCdMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<OCCdMigrationCatalogState> {
  return requestCatalogState(pairingCode, 'stage', manifest, options)
}

/** Expected blobs make the destination refuse incomplete commits. */
export async function commitRemoteOCCdMigrationCatalog(
  pairingCode: string,
  manifest: OCCdMigrationManifest,
  options: CatalogRequestOptions & {
    expectedBlobs?: readonly OCCdMigrationBlobDescriptor[]
  } = {}
): Promise<OCCdMigrationCatalogState> {
  const result = await request(pairingCode, 'commit', manifest, options, options.expectedBlobs)
  return parseOCCdMigrationCatalogState(result, manifest)
}

export function readRemoteOCCdMigrationCatalogState(
  pairingCode: string,
  manifest: OCCdMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<OCCdMigrationCatalogState> {
  return requestCatalogState(pairingCode, 'state', manifest, options)
}

export async function abortRemoteOCCdMigrationCatalog(
  pairingCode: string,
  manifest: OCCdMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<OCCdMigrationCatalogAbortResult> {
  const result = await request(pairingCode, 'abort', manifest, options)
  const parsed = parseOCCdMigrationCatalogAbortResult(result, manifest)
  // Older already-absent replies prove no durability, unlike real aborts.
  if (parsed.state === 'absent' && !parsed.aborted && parsed.durableAbsent !== true) {
    throw new Error('occd_migration_abort_durability_unverifiable:destination_update_required')
  }
  return parsed
}

export async function stageRemoteOCCdMigrationSnapshotChunk(
  pairingCode: string,
  request: OCCdMigrationSnapshotChunkRequest,
  options: CatalogRequestOptions = {}
): Promise<OCCdMigrationSnapshotChunkResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('occd_migration_pairing_code_invalid')
  }
  const response = await sendSupportedMigrationRequest(
    pairing,
    'occd.migration.stageSnapshotChunk',
    request,
    options
  )
  if (!response.ok) {
    throw new Error(`occd_migration_snapshot_failed:${response.error.message}`)
  }
  return parseOCCdMigrationSnapshotChunkResult(response.result, request)
}

export async function stageRemoteOCCdMigrationBlobChunk(
  pairingCode: string,
  request: OCCdMigrationBlobChunkRequest,
  options: CatalogRequestOptions = {}
): Promise<OCCdMigrationBlobChunkResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('occd_migration_pairing_code_invalid')
  }
  const response = await sendSupportedMigrationRequest(
    pairing,
    'occd.migration.stageBlobChunk',
    request,
    options,
    false,
    null,
    // Recheck every request so a downgraded destination cannot stage an unsupported blob kind.
    (capabilities) => {
      const unsupported = findUnsupportedMigrationBlobKind([request.blob], capabilities)
      if (unsupported) {
        throw new Error(occdMigrationBlobKindUnsupportedBlocker(unsupported))
      }
    }
  )
  if (!response.ok) {
    throw new Error(`occd_migration_blob_failed:${response.error.message}`)
  }
  return parseOCCdMigrationBlobChunkResult(response.result, request)
}

export async function listServerRows(
  pairingCode: string,
  method: string,
  rows: string,
  options: CatalogRequestOptions
): Promise<unknown> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('occd_migration_pairing_code_invalid')
  }
  const response = await sendSupportedMigrationRequest(pairing, method, undefined, options)
  if (!response.ok) {
    throw new Error(`occd_migration_${rows}_failed:${response.error.message}`)
  }
  return response.result
}

// repo.list returns full stored rows; omitted host fields identify server-local repos.
const ServerRepositoriesSchema = z.object({
  repos: z.array(
    z.object({
      id: z.string().min(1),
      path: z.string().min(1),
      connectionId: z.string().nullish(),
      executionHostId: z.string().nullish(),
      projectGroupId: z.string().nullish()
    })
  )
})

export async function listRemoteOCCdRepositories(
  pairingCode: string,
  options: CatalogRequestOptions = {}
): Promise<OCCdServerRepository[]> {
  const result = await listServerRows(pairingCode, 'repo.list', 'repositories', options)
  return ServerRepositoriesSchema.parse(result).repos.map(
    ({ id, path, connectionId, executionHostId, projectGroupId }) => ({
      id,
      path,
      ...(connectionId != null ? { connectionId } : {}),
      ...(executionHostId != null ? { executionHostId } : {}),
      ...(projectGroupId != null ? { projectGroupId } : {})
    })
  )
}

async function requestCatalogState(
  pairingCode: string,
  operation: Exclude<OCCdCatalogMigrationOperation, 'abort'>,
  manifest: OCCdMigrationManifest,
  options: CatalogRequestOptions
): Promise<OCCdMigrationCatalogState> {
  const result = await request(pairingCode, operation, manifest, options)
  return parseOCCdMigrationCatalogState(result, manifest)
}

async function request(
  pairingCode: string,
  operation: OCCdCatalogMigrationOperation,
  manifest: OCCdMigrationManifest,
  options: CatalogRequestOptions,
  expectedBlobs: readonly OCCdMigrationBlobDescriptor[] = []
): Promise<unknown> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('occd_migration_pairing_code_invalid')
  }
  // Preserve exact { manifest } wire shape for blob-free and SSH moves.
  const params = expectedBlobs.length > 0 ? { manifest, expectedBlobs } : { manifest }
  // Validation-size limits can exceed sealed-frame capacity; reject before the host closes the socket.
  assertOCCdMigrationRequestFits(params)
  const imports = operation === 'stage' || operation === 'commit'
  const carriesExtraAgentArgs =
    imports &&
    (manifest.payload.dormantState?.automations ?? []).some((automation) =>
      hasExtraAgentArgs(automation.extraAgentArgs)
    )
  // An older host would drop the blob a manifest names and import without its rows.
  const requiredBlobs = imports
    ? [...expectedBlobs, ...occdMigrationManifestBlobs(manifest)]
    : expectedBlobs
  const response = await sendSupportedMigrationRequest(
    pairing,
    METHOD_BY_OPERATION[operation],
    params,
    options,
    carriesExtraAgentArgs,
    // Recheck source capabilities on every operation; older hosts may misparse non-SSH sources.
    requiredOCCdMigrationSourceCapability(manifest.source),
    // Hosts without blob capability would strip expectedBlobs and commit unchecked.
    (capabilities) => {
      if (
        imports &&
        (manifest.payload.dormantState?.automations ?? []).some((automation) =>
          hasModernAutomationLaunchSetup(automationCanonicalLaunchSetup(automation))
        ) &&
        !capabilities.includes(AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY)
      ) {
        throw new Error(
          'Update OCC on the destination host to keep automation agent launch settings.'
        )
      }
      const unsupported = findUnsupportedMigrationBlobKind(requiredBlobs, capabilities)
      if (unsupported) {
        throw new Error(occdMigrationBlobKindUnsupportedBlocker(unsupported))
      }
    }
  )
  if (!response.ok) {
    throw new Error(`occd_migration_${operation}_failed:${response.error.message}`)
  }
  return response.result
}

export async function sendSupportedMigrationRequest(
  pairing: NonNullable<ReturnType<typeof parsePairingCode>>,
  method: string,
  params: unknown,
  options: CatalogRequestOptions,
  requiresExtraAgentArgs = false,
  requiredSourceCapability: string | null = null,
  assertCapabilities: (capabilities: readonly string[]) => void = () => {}
): Promise<RuntimeRpcResponse<unknown>> {
  const response = await sendRemoteRuntimeRequestWithStatusPreflight<unknown>(
    pairedRuntimeConnectionFromOffer(pairing),
    method,
    params,
    options.timeoutMs ?? 15_000,
    (status) => {
      if (!status.ok) {
        throw new Error(`occd_migration_status_failed:${status.error.message}`)
      }
      if (
        options.expectedRuntimeId !== undefined &&
        status._meta?.runtimeId !== options.expectedRuntimeId
      ) {
        throw new Error('occd_migration_destination_runtime_mismatch')
      }
      if (!status.result.capabilities?.includes(OCCD_MIGRATION_CATALOG_RUNTIME_CAPABILITY)) {
        throw new Error(OCCD_MIGRATION_DESTINATION_UNSUPPORTED)
      }
      if (
        requiresExtraAgentArgs &&
        !status.result.capabilities?.includes(AUTOMATION_EXTRA_AGENT_ARGS_RUNTIME_CAPABILITY)
      ) {
        throw new Error(OCCD_MIGRATION_DESTINATION_EXTRA_AGENT_ARGS_UNSUPPORTED)
      }
      if (
        requiredSourceCapability !== null &&
        !status.result.capabilities?.includes(requiredSourceCapability)
      ) {
        throw new Error(OCCD_MIGRATION_DESTINATION_SOURCE_KIND_UNSUPPORTED)
      }
      assertCapabilities(status.result.capabilities ?? [])
    },
    undefined,
    ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES,
    options.signal
  )
  if (!response.ok && response.error.code === 'method_not_found') {
    throw new Error(OCCD_MIGRATION_DESTINATION_UNSUPPORTED)
  }
  if (
    options.expectedRuntimeId !== undefined &&
    response._meta?.runtimeId !== options.expectedRuntimeId
  ) {
    throw new Error('occd_migration_destination_runtime_mismatch')
  }
  return response
}
