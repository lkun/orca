/** Export copied catalog/dormant state without mutating source. Path rewriting precedes signing; source ownership remains until cutover establishes destination authority. */
import { randomUUID } from 'node:crypto'
import {
  MAX_OCCD_MIGRATION_MANIFEST_BYTES,
  OCCD_MIGRATION_MANIFEST_VERSION,
  parseOCCdMigrationManifest
} from '../../shared/occd-migration/occd-migration-manifest-validation'
import type {
  OCCdMigrationCatalogPayload,
  OCCdMigrationDormantStatePayload,
  OCCdMigrationManifest
} from '../../shared/occd-migration/occd-migration-manifest'
import type { SshTarget } from '../../shared/ssh-types'
import { REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES } from '../../shared/remote-runtime/remote-runtime-memory-limits'
import type { Store } from '../persistence/loading-store/store'
import { collectOCCdMigrationSourceCatalog } from '../persistence/migrating-occd-catalog/occd-source-catalog'
import { computeOCCdMigrationManifestSha256 } from '../occd/occd-migration-manifest-digest'
import {
  IDENTITY_OCCD_MIGRATION_PATH_REWRITER,
  rewriteOCCdMigrationPayloadPaths,
  type OCCdMigrationPathRewriter
} from './occd-migration-path-rewrite'

export type OCCdMigrationExportStore = Pick<
  Store,
  | 'collectOCCdMigrationSourceDormantState'
  | 'getFolderWorkspaces'
  | 'getProjectGroups'
  | 'getRepos'
> & {
  /** Groups the server's record wins for: still read for row ownership, never exported. */
  serverOwnedProjectGroupIds?: ReadonlySet<string>
}

export type OCCdMigrationManifestExportOptions = {
  migrationId?: string
  now?: () => Date
  destinationEnvironmentId?: string
  onlyCatalog?: OCCdMigrationCatalogIds
  /** Maps source paths to destination paths before signing; identity for an SSH host. */
  rewrite?: OCCdMigrationPathRewriter
}

export function createOCCdMigrationManifest(
  store: OCCdMigrationExportStore,
  target: SshTarget,
  options: OCCdMigrationManifestExportOptions = {}
): OCCdMigrationManifest {
  const rewrite = options.rewrite ?? IDENTITY_OCCD_MIGRATION_PATH_REWRITER
  const collected = restrictCatalog(
    collectOCCdMigrationSourceCatalog(store, target),
    options.onlyCatalog
  )
  const serverOwned = store.serverOwnedProjectGroupIds
  const sourcePayload = serverOwned
    ? {
        ...collected,
        projectGroups: collected.projectGroups.filter((group) => !serverOwned.has(group.id))
      }
    : collected
  const source = {
    sshTargetId: target.id,
    sshTargetGeneration: target.generation ?? null,
    targetLabel: target.label
  }
  const dormantState = store.collectOCCdMigrationSourceDormantState(
    source,
    sourcePayload,
    options.destinationEnvironmentId
  )
  // Select dormant state using source identities before rewriting destination paths.
  const payload = rewriteOCCdMigrationPayloadPaths(
    { ...sourcePayload, ...(hasDormantState(dormantState) ? { dormantState } : {}) },
    rewrite
  )
  const unsigned = {
    version: OCCD_MIGRATION_MANIFEST_VERSION,
    migrationId: options.migrationId ?? randomUUID(),
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    source,
    payload,
    ...(options.destinationEnvironmentId
      ? { destinationEnvironmentId: options.destinationEnvironmentId }
      : {})
  }
  try {
    // Sign what the journal and the host read back: the parsed form (the parser keeps only the fields
    // it knows) of the JSON (a value with toJSON serializes differently), never the live objects.
    const { manifestSha256: _unsigned, ...normalized } = parseOCCdMigrationManifest({
      ...JSON.parse(JSON.stringify(unsigned)),
      manifestSha256: UNSIGNED_DIGEST
    })
    return { ...normalized, manifestSha256: computeOCCdMigrationManifestSha256(normalized) }
  } catch (error) {
    if (error instanceof Error && error.message === OCCD_MIGRATION_MANIFEST_TOO_LARGE) {
      throw new Error(describeOversizedOCCdMigrationPayload(payload))
    }
    throw error
  }
}

const OCCD_MIGRATION_MANIFEST_TOO_LARGE = 'occd_migration_manifest_too_large'
const UNSIGNED_DIGEST = '0'.repeat(64)

// Request id, device token, method name and JSON framing around the params.
const REQUEST_ENVELOPE_RESERVE_BYTES = 1024
/** The largest catalog-request params that still fit the host's sealed inbound frame. */
export const OCCD_MIGRATION_REQUEST_PARAMS_BUDGET_BYTES =
  REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES - REQUEST_ENVELOPE_RESERVE_BYTES

/** Reject oversized manifest requests before fencing: stage/state/full abort would all exceed the sealed frame and close its socket. */
export function assertOCCdMigrationRequestFits(params: {
  manifest: OCCdMigrationManifest
}): void {
  if (!occdMigrationRequestFits(params)) {
    throw new Error(
      describeOversizedOCCdMigrationPayload(
        params.manifest.payload,
        OCCD_MIGRATION_REQUEST_PARAMS_BUDGET_BYTES
      )
    )
  }
}

export function occdMigrationRequestFits(params: { manifest: OCCdMigrationManifest }): boolean {
  return (
    Buffer.byteLength(JSON.stringify(params), 'utf8') <= OCCD_MIGRATION_REQUEST_PARAMS_BUDGET_BYTES
  )
}

/** Name the largest sections and how to trim them; a bare error code was unhelpful (#30126). */
export function describeOversizedOCCdMigrationPayload(
  payload: OCCdMigrationCatalogPayload,
  limitBytes = MAX_OCCD_MIGRATION_MANIFEST_BYTES
): string {
  const dormant = payload.dormantState
  const parts: [string, unknown][] = [
    ['projects', payload.repositories],
    ['folder workspaces', payload.folderWorkspaces],
    ['project groups', payload.projectGroups],
    ['saved tabs and panes', dormant?.workspaceSession],
    ['saved terminal history', dormant?.terminalScrollbackSnapshots],
    ['saved workspace details', dormant?.worktreeMeta],
    ['workspace history', [dormant?.worktreeLineage, dormant?.workspaceLineage]],
    ['sparse checkout presets', dormant?.sparsePresets],
    [
      'retired workspace names',
      [dormant?.retiredWorktreeNames, dormant?.retiredWorktreeNamespaces]
    ],
    ['automations', [dormant?.automations, dormant?.automationRuns]],
    ['sidebar and browser settings', dormant?.clientState]
  ]
  const largest = parts
    .map(([words, value]) => ({
      words,
      bytes: new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength
    }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 3)
    .map(({ words, bytes }) => `${words} (${formatKib(bytes)})`)
  return (
    `This SSH host's saved state is too large to move to its OCC server (limit ` +
    `${formatKib(limitBytes)}). Largest parts: ${largest.join(', ')}. ` +
    `Close tabs you no longer need or remove unused projects for this host, then reconnect. ` +
    `(${OCCD_MIGRATION_MANIFEST_TOO_LARGE})`
  )
}

function formatKib(bytes: number): string {
  return `${Math.ceil(bytes / 1024)} KB`
}

export type OCCdMigrationCatalogIds = {
  repositoryIds: ReadonlySet<string>
  folderWorkspaceIds: ReadonlySet<string>
  projectGroupIds: ReadonlySet<string>
}

export function occdMigrationCatalogIds(
  payloads: readonly OCCdMigrationCatalogPayload[]
): OCCdMigrationCatalogIds {
  return {
    repositoryIds: new Set(payloads.flatMap((p) => p.repositories.map((row) => row.id))),
    folderWorkspaceIds: new Set(payloads.flatMap((p) => p.folderWorkspaces.map((row) => row.id))),
    projectGroupIds: new Set(payloads.flatMap((p) => p.projectGroups.map((row) => row.id)))
  }
}

function restrictCatalog(
  payload: OCCdMigrationCatalogPayload,
  ids: OCCdMigrationCatalogIds | undefined
): OCCdMigrationCatalogPayload {
  if (!ids) {
    return payload
  }
  return {
    repositories: payload.repositories.filter((row) => ids.repositoryIds.has(row.id)),
    folderWorkspaces: payload.folderWorkspaces.filter((row) => ids.folderWorkspaceIds.has(row.id)),
    projectGroups: payload.projectGroups.filter((row) => ids.projectGroupIds.has(row.id))
  }
}

export function hasDormantState(state: OCCdMigrationDormantStatePayload): boolean {
  return (
    state.worktreeMeta.length > 0 ||
    state.worktreeLineage.length > 0 ||
    state.workspaceLineage.length > 0 ||
    state.sparsePresets.length > 0 ||
    state.retiredWorktreeNames.length > 0 ||
    state.retiredWorktreeNamespaces.length > 0 ||
    state.workspaceSession !== undefined ||
    (state.terminalScrollbackSnapshots?.length ?? 0) > 0 ||
    (state.automations?.length ?? 0) > 0 ||
    (state.automationRuns?.length ?? 0) > 0 ||
    (state.clientState !== undefined && Object.keys(state.clientState).length > 0)
  )
}
