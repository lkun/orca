/** Subtract earlier migrations' currently retained rows/state; export only additions. Never merge overlapping old source copies over server-owned state. */
import type { OCCdDeltaMovePreview, OCCdDeltaMoveRow } from '../../shared/occd-managed-runtime'
import type {
  OCCdMigrationCatalogPayload,
  OCCdMigrationManifest
} from '../../shared/occd-migration/occd-migration-manifest'
import { isRetainedOCCdMigrationSourceCutover } from '../../shared/occd-migration/occd-migration-source-cutover'
import type { OCCdMigrationSourceCutover } from '../../shared/occd-migration/occd-migration-source-cutover'
import type { SshTarget } from '../../shared/ssh-types'
import type { Store } from '../persistence'
import { collectOCCdMigrationSourceCatalog } from '../persistence/migrating-occd-catalog/occd-source-catalog'
import { listOCCdMigrationCutoverChainForTarget } from './occd-migration-cutover-journal'
import {
  createOCCdMigrationManifest,
  occdMigrationCatalogIds,
  type OCCdMigrationCatalogIds
} from './occd-migration-manifest-export'
import type { OCCdMigrationSnapshotSource } from './occd-migration-snapshot-coordinator'
import { collectUntransferredDependentBlockers } from './targets/ssh-target-occd-dependents'
import type { OCCdMigrationPreflightStore } from './targets/ssh-target-occd-preflight'

export type OCCdDeltaSourceStore = OCCdMigrationPreflightStore & OCCdMigrationSnapshotSource

export function unfinishedOCCdDelta(
  chain: readonly OCCdMigrationSourceCutover[]
): OCCdMigrationSourceCutover | null {
  const head = chain.at(-1)
  return head?.supersedesMigrationId &&
    head.phase !== 'source-retired' &&
    !isRetainedOCCdMigrationSourceCutover(head)
    ? head
    : null
}

export function committedOCCdMigrationChain(
  chain: readonly OCCdMigrationSourceCutover[]
): OCCdMigrationSourceCutover[] {
  return (unfinishedOCCdDelta(chain) ? chain.slice(0, -1) : chain).filter(
    (cutover) => cutover.phase === 'destination-committed' || cutover.phase === 'source-retired'
  )
}

export function occdDeltaSourceStore(
  store: Store,
  target: SshTarget,
  moved: readonly OCCdMigrationSourceCutover[],
  /** Older interrupted deltas may still include server-owned groups. */
  journaled?: OCCdMigrationManifest
): OCCdDeltaSourceStore {
  const ids = occdMigrationCatalogIds(moved.map((cutover) => cutover.manifest.payload))
  // Never move projects/groups already owned through earlier links.
  const linked = moved.flatMap((cutover) => cutover.linkedRepositoryIds ?? [])
  const linkedGroups = moved.flatMap((cutover) => cutover.linkedProjectGroupIds ?? [])
  const linkedFolders = moved.flatMap((cutover) => cutover.linkedFolderWorkspaceIds ?? [])
  // New rows reference server-owned groups; exporting retained copies could overwrite newer server edits.
  const serverGroups = new Set([...ids.projectGroupIds, ...linkedGroups])
  const exported = new Set(journaled?.payload.projectGroups.map((group) => group.id))
  return occdSourceStoreWithout(
    store,
    target,
    {
      ...ids,
      repositoryIds: new Set([...ids.repositoryIds, ...linked]),
      folderWorkspaceIds: new Set([...ids.folderWorkspaceIds, ...linkedFolders]),
      projectGroupIds: serverGroups
    },
    moved.at(-1)?.destinationEnvironmentId,
    new Set([...serverGroups].filter((id) => !exported.has(id)))
  )
}

export function occdSourceStoreWithout(
  store: Store,
  target: SshTarget,
  owned: OCCdMigrationCatalogIds,
  destinationEnvironmentId: string | undefined,
  /** Groups the server's record wins for: never exported, even while a moving row sits in one. */
  serverGroupIds: ReadonlySet<string> = new Set()
): OCCdDeltaSourceStore {
  const ownedNow = createOCCdMigrationManifest(store, target, {
    destinationEnvironmentId,
    onlyCatalog: owned
  })
  const view = store.createOCCdMigrationDeltaView(ownedNow)
  return {
    ...view,
    serverOwnedProjectGroupIds: serverGroupIds,
    getSshTarget: (id) => store.getSshTarget(id),
    getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id),
    readOCCdMigrationSourceSnapshotChunk: (...args) =>
      store.readOCCdMigrationSourceSnapshotChunk(...args)
  }
}

export type OCCdDeltaMovePlan = OCCdDeltaMovePreview & {
  manifest: OCCdMigrationManifest
  moved: OCCdMigrationSourceCutover[]
  head: OCCdMigrationSourceCutover
  resumes: OCCdMigrationSourceCutover | null
  source: OCCdDeltaSourceStore
}

export function planOCCdDeltaMove(
  userDataPath: string,
  store: Store,
  target: SshTarget,
  options: { migrationId?: string; now?: () => Date } = {}
): OCCdDeltaMovePlan {
  const environmentId = target.occdFence?.environmentId
  if (!environmentId || !target.occdFence?.sourceChangedAt) {
    throw new Error('occd_delta_not_changed')
  }
  const chain = listOCCdMigrationCutoverChainForTarget(userDataPath, target.id)
  const resumes = unfinishedOCCdDelta(chain)
  const moved = committedOCCdMigrationChain(chain)
  const head = chain.at(resumes ? -2 : -1)
  if (
    !head ||
    !isRetainedOCCdMigrationSourceCutover(head) ||
    moved.at(-1)?.migrationId !== head.migrationId
  ) {
    throw new Error('occd_delta_no_retained_migration')
  }
  const source = occdDeltaSourceStore(store, target, moved, resumes?.manifest)
  const manifest =
    resumes?.manifest ??
    createOCCdMigrationManifest(source, target, {
      migrationId: options.migrationId,
      now: options.now,
      destinationEnvironmentId: environmentId
    })
  const current = collectOCCdMigrationSourceCatalog(store, target)
  return {
    sshTargetId: target.id,
    environmentId,
    added: catalogRows(manifest.payload),
    notReflected: notReflected(
      current,
      moved.map((cutover) => cutover.manifest.payload)
    ),
    blockers: collectUntransferredDependentBlockers(source, manifest),
    manifest,
    moved,
    head,
    resumes,
    source
  }
}

function catalogRows(catalog: OCCdMigrationCatalogPayload): OCCdDeltaMoveRow[] {
  return [
    ...catalog.repositories.map((row) => ({
      kind: 'repository' as const,
      id: row.id,
      label: row.displayName
    })),
    ...catalog.folderWorkspaces.map((row) => ({
      kind: 'folder-workspace' as const,
      id: row.id,
      label: row.name
    })),
    ...catalog.projectGroups.map((row) => ({
      kind: 'project-group' as const,
      id: row.id,
      label: row.name
    }))
  ]
}

/** Rows earlier migrations moved that an older build has since changed or removed. */
function notReflected(
  current: OCCdMigrationCatalogPayload,
  movedPayloads: readonly OCCdMigrationCatalogPayload[]
): OCCdDeltaMovePreview['notReflected'] {
  const latestMoved = new Map<string, { row: OCCdDeltaMoveRow; identity: string }>()
  for (const payload of movedPayloads) {
    for (const row of catalogRows(payload)) {
      latestMoved.set(`${row.kind}:${row.id}`, { row, identity: identityOf(payload, row) })
    }
  }
  const currentByKey = new Map(
    catalogRows(current).map((row) => [`${row.kind}:${row.id}`, identityOf(current, row)])
  )
  const edited: OCCdDeltaMoveRow[] = []
  const removed: OCCdDeltaMoveRow[] = []
  for (const [key, moved] of latestMoved) {
    const identity = currentByKey.get(key)
    if (identity === undefined) {
      removed.push(moved.row)
    } else if (identity !== moved.identity) {
      edited.push(moved.row)
    }
  }
  return { edited, removed }
}

function identityOf(catalog: OCCdMigrationCatalogPayload, row: OCCdDeltaMoveRow): string {
  switch (row.kind) {
    case 'repository': {
      const repo = catalog.repositories.find((entry) => entry.id === row.id)
      return `${repo?.path}\0${repo?.displayName}`
    }
    case 'folder-workspace': {
      const folder = catalog.folderWorkspaces.find((entry) => entry.id === row.id)
      return `${folder?.folderPath}\0${folder?.name}`
    }
    case 'project-group':
      return catalog.projectGroups.find((entry) => entry.id === row.id)?.name ?? ''
  }
}
