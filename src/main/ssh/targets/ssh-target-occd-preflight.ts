/** Read-only export preflight: catalog rows and representable dormant state can migrate; ownership, live leases and untransferred dependencies block. */
import { isLiveSshPtyLease } from '../../../shared/ssh-types'
import type { Store } from '../../persistence/loading-store/store'
import type {
  OCCdMigrationBlocker,
  OCCdMigrationPreflight
} from '../../../shared/occd-migration/occd-migration-preflight'
import {
  createOCCdMigrationManifest,
  type OCCdMigrationExportStore
} from '../occd-migration-manifest-export'
import {
  collectTargetCatalogBlockers,
  resolveOCCdPreflightTarget
} from './ssh-target-occd-claims'
import { collectUntransferredDependentBlockers } from './ssh-target-occd-dependents'
import {
  preservesOCCdMigrationBridgedPanes,
  type OCCdMigrationPaneLeasePredicate
} from '../occd-migration-bridged-panes'

export type OCCdMigrationPreflightStore = OCCdMigrationExportStore &
  Pick<
    Store,
    'getSshTarget' | 'getSshRemotePtyLeases' | 'inspectOCCdMigrationUntransferredDependencies'
  >

/** `owner` passes the environment's own fence only when its migration journal is on disk. */
export function preflightOCCdMigrationExport(
  store: OCCdMigrationPreflightStore,
  targetId: string,
  owner?: { environmentId: string; recorded: boolean },
  /** COMPAT(legacy-relay-bridge): leases a bridged proof left running for the bridge. */
  bridgedPtyIds: readonly string[] = []
): OCCdMigrationPreflight {
  const resolved = resolveOCCdPreflightTarget(store, targetId, owner)
  if ('result' in resolved) {
    return resolved.result
  }
  const { target } = resolved
  const blockers: OCCdMigrationBlocker[] = [...collectTargetCatalogBlockers(store, target)]
  const terminalLeases = store
    .getSshRemotePtyLeases(targetId)
    .filter((lease) => isLiveSshPtyLease(lease) && !bridgedPtyIds.includes(lease.ptyId))
    .map(({ ptyId, worktreeId, tabId, leafId, state, updatedAt }) => ({
      ptyId,
      worktreeId,
      tabId,
      leafId,
      state,
      updatedAt
    }))
  if (terminalLeases.length > 0) {
    // A relay PTY cannot move to occd; its work must finish first.
    blockers.push({
      code: 'occd_migration_direct_ssh_terminal_leases',
      category: 'live-or-unverifiable',
      terminalLeases
    })
  }
  blockers.push(
    ...collectUntransferredDependentBlockers(store, createOCCdMigrationManifest(store, target))
  )
  return {
    targetId,
    targetLabel: target.label,
    claimable: !blockers.some(isBlockingOCCdMigrationBlocker),
    blockers
  }
}

/** Confirmed Move anyway can leave saved state, but desktop drafts that cannot be left still block. */
export function leaveBehindClearsOCCdMigrationBlockers(
  store: OCCdMigrationPreflightStore & Pick<Store, 'createOCCdMigrationLeaveBehindView'>,
  targetId: string,
  bridgedPtyIds: readonly string[] = [],
  isBridgedPaneLease?: OCCdMigrationPaneLeasePredicate
): boolean {
  const view = store.createOCCdMigrationLeaveBehindView(targetId)
  const preflight = preflightOCCdMigrationExport(
    {
      ...view,
      getSshTarget: (id) => store.getSshTarget(id),
      getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id)
    },
    targetId,
    undefined,
    bridgedPtyIds
  )
  const target = store.getSshTarget(targetId)
  return (
    preflight.claimable &&
    target !== undefined &&
    preservesOCCdMigrationBridgedPanes(
      createOCCdMigrationManifest(view, target).payload,
      store.getSshRemotePtyLeases(targetId),
      bridgedPtyIds,
      isBridgedPaneLease
    )
  )
}

/** Only saved state blocks: a confirmed "Move anyway" may leave it on this desktop. */
export function onlyLeavableOCCdMigrationBlockers(
  blockers: readonly OCCdMigrationBlocker[]
): boolean {
  const blocking = blockers.filter(isBlockingOCCdMigrationBlocker)
  return (
    blocking.length > 0 &&
    blocking.every((blocker) => blocker.code === 'occd_migration_dependent_state')
  )
}

export function isBlockingOCCdMigrationBlocker(blocker: OCCdMigrationBlocker): boolean {
  return (
    blocker.category !== 'drainable-static-state' &&
    blocker.code !== 'occd_migration_saved_port_forwards'
  )
}
