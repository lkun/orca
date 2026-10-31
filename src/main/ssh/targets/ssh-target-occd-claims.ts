/** occdFence reserves a target for its managed tunnel and refuses direct relay access. Claim only empty targets; existing state requires catalog migration. */
import type { Store } from '../../persistence'
import {
  getManagedOCCdFenceEnvironmentId,
  isEphemeralRuntimeSshOwner
} from '../../../shared/managed-occd-ssh-owner'
import type {
  OCCdMigrationBlocker,
  OCCdMigrationPreflight
} from '../../../shared/occd-migration/occd-migration-preflight'
import type { SshTarget } from '../../../shared/ssh-types'
import {
  collectDependentStateBlockers,
  dependentStateMessage,
  type DependentStateStore
} from './ssh-target-occd-dependents'

type ClaimStore = DependentStateStore &
  Pick<
    Store,
    | 'allocateSshTargetGeneration'
    | 'flushPendingOrThrowAsync'
    | 'getFolderWorkspaces'
    | 'getRepos'
    | 'getSshTarget'
    | 'getSshTargets'
    | 'updateSshTarget'
  >

export class SshTargetOCCdClaims {
  constructor(private readonly store: ClaimStore) {}

  listTargets(): SshTarget[] {
    return this.store.getSshTargets()
  }

  /** Reuse an own claim only when a durable provisioning/SSH-access intent or migration journal explains it. */
  preflight(
    targetId: string,
    owner?: { environmentId: string; recorded: boolean }
  ): OCCdMigrationPreflight {
    const resolved = resolveOCCdPreflightTarget(this.store, targetId, owner)
    if ('result' in resolved) {
      return resolved.result
    }
    const { target } = resolved
    const blockers = collectEmptyTargetBlockers(this.store, target)
    return { targetId, targetLabel: target.label, claimable: blockers.length === 0, blockers }
  }

  /** Caller must persist the claim before remote action; deployName identifies interrupted provisioning. */
  claim(
    targetId: string,
    environmentId: string,
    options: { deployName?: string; ownerRecorded: boolean }
  ): SshTarget {
    const { deployName } = options
    const blocker = this.preflight(targetId, {
      environmentId,
      recorded: options.ownerRecorded
    }).blockers[0]
    if (blocker) {
      throw new Error(occdTargetBlockerMessage(targetId, blocker))
    }
    const target = this.requireTarget(targetId)
    const owned = getManagedOCCdFenceEnvironmentId(target) === environmentId
    if (owned && target.generation && !target.managedServerRemoved) {
      return target
    }
    const claimed = this.store.updateSshTarget(targetId, {
      occdFence: { environmentId },
      // A new claim is the user setting a server up again; lift any earlier removal hold.
      managedServerRemoved: undefined,
      generation: target.generation ?? this.store.allocateSshTargetGeneration(),
      ...(deployName && !target.occdProvisioning
        ? { occdProvisioning: { requestId: environmentId, name: deployName } }
        : {})
    })
    if (!claimed) {
      throw new Error(`SSH target "${targetId}" disappeared while it was being reserved.`)
    }
    return claimed
  }

  /** A durable registration generation, so a fence and its journal bind to one registration. */
  ensureGeneration(targetId: string): number {
    const target = this.requireTarget(targetId)
    if (target.generation !== undefined) {
      return target.generation
    }
    const generation = this.store.allocateSshTargetGeneration()
    if (!this.store.updateSshTarget(targetId, { generation })) {
      throw new Error(`SSH target "${targetId}" disappeared while assigning its generation.`)
    }
    return generation
  }

  /** Skip empty-target checks only after conversion preflight and a durable migration journal. */
  fenceForMigration(targetId: string, environmentId: string, generation: number): SshTarget {
    const target = this.requireTarget(targetId)
    if (target.generation !== generation) {
      throw new Error('occd_migration_target_generation_changed')
    }
    const holder = targetHolder(target)
    if (holder && !(holder.kind === 'managed-server' && holder.environmentId === environmentId)) {
      throw new Error(
        occdTargetBlockerMessage(targetId, {
          code: 'occd_migration_target_owned',
          category: 'exclusive-ownership',
          holder
        })
      )
    }
    const fenced = this.store.updateSshTarget(targetId, { occdFence: { environmentId } })
    if (!fenced) {
      throw new Error(`SSH target "${targetId}" disappeared while it was being fenced.`)
    }
    return fenced
  }

  release(targetId: string, environmentId: string): SshTarget | null {
    const target = this.store.getSshTarget(targetId)
    if (!target || getManagedOCCdFenceEnvironmentId(target) !== environmentId) {
      return null
    }
    return this.store.updateSshTarget(targetId, {
      occdFence: undefined,
      occdProvisioning: undefined
    })
  }

  /** The user removed this server: release it and keep automatic dials from deploying another. */
  releaseForUserRemoval(targetId: string, environmentId: string): SshTarget | null {
    const target = this.store.getSshTarget(targetId)
    if (!target) {
      return null
    }
    const owned = getManagedOCCdFenceEnvironmentId(target) === environmentId
    return this.store.updateSshTarget(targetId, {
      ...(owned ? { occdFence: undefined, occdProvisioning: undefined } : {}),
      managedServerRemoved: { removedAt: new Date().toISOString() }
    })
  }

  /** Ownership must be on disk before a remote host acts on it. */
  flush(signal?: AbortSignal): Promise<void> {
    return this.store.flushPendingOrThrowAsync({ signal, drainToStableGeneration: false })
  }

  private requireTarget(targetId: string): SshTarget {
    const target = this.store.getSshTarget(targetId)
    if (!target) {
      throw new Error(`SSH target "${targetId}" not found.`)
    }
    return target
  }
}

/** An own fence requires a durable owner record for both claim and export preflight. */
export function resolveOCCdPreflightTarget(
  store: Pick<Store, 'getSshTarget'>,
  targetId: string,
  owner?: { environmentId: string; recorded: boolean }
): { result: OCCdMigrationPreflight } | { target: SshTarget } {
  const target = store.getSshTarget(targetId)
  if (!target) {
    return {
      result: {
        targetId,
        targetLabel: null,
        claimable: false,
        blockers: [{ code: 'occd_migration_target_not_found', category: 'registration' }]
      }
    }
  }
  if (!owner || getManagedOCCdFenceEnvironmentId(target) !== owner.environmentId) {
    return { target }
  }
  return {
    result: owner.recorded
      ? { targetId, targetLabel: target.label, claimable: true, blockers: [] }
      : {
          targetId,
          targetLabel: target.label,
          claimable: false,
          blockers: [{ code: 'occd_migration_owner_unrecorded', category: 'exclusive-ownership' }]
        }
  }
}

function collectEmptyTargetBlockers(store: ClaimStore, target: SshTarget): OCCdMigrationBlocker[] {
  return [
    ...collectTargetCatalogBlockers(store, target),
    ...collectDependentStateBlockers(store, target.id)
  ]
}

export function collectTargetCatalogBlockers(
  store: Pick<Store, 'getFolderWorkspaces' | 'getRepos'>,
  target: SshTarget
): OCCdMigrationBlocker[] {
  const blockers: OCCdMigrationBlocker[] = []
  const holder = targetHolder(target)
  if (holder) {
    blockers.push({ code: 'occd_migration_target_owned', category: 'exclusive-ownership', holder })
  }
  const repositories = store
    .getRepos()
    .filter((repo) => repo.connectionId === target.id)
    .map(({ id, path, displayName, kind }) => ({ id, path, displayName, kind }))
  if (repositories.length > 0) {
    blockers.push({
      code: 'occd_migration_direct_ssh_repositories',
      category: 'drainable-static-state',
      repositories
    })
  }
  const folderWorkspaces = store
    .getFolderWorkspaces()
    .filter((workspace) => workspace.connectionId === target.id)
    .map(({ id, name, folderPath }) => ({ id, name, folderPath }))
  if (folderWorkspaces.length > 0) {
    blockers.push({
      code: 'occd_migration_direct_ssh_folder_workspaces',
      category: 'drainable-static-state',
      folderWorkspaces
    })
  }
  if (target.portForwards?.length) {
    blockers.push({
      code: 'occd_migration_saved_port_forwards',
      category: 'client-owned-state',
      portForwards: target.portForwards.map((portForward) => ({ ...portForward }))
    })
  }
  return blockers
}

/** Who holds the target exclusively: a managed OCC server, or an unmigrated legacy owner. */
function targetHolder(
  target: SshTarget
): Extract<OCCdMigrationBlocker, { code: 'occd_migration_target_owned' }>['holder'] | null {
  // Why: a recipe VM's runtime owns when the host is created and destroyed, not which server runs it.
  if (target.owner && !isEphemeralRuntimeSshOwner(target.owner)) {
    return { kind: 'runtime', runtimeId: target.owner.runtimeId }
  }
  const environmentId = getManagedOCCdFenceEnvironmentId(target)
  return environmentId ? { kind: 'managed-server', environmentId } : null
}

export function occdTargetBlockerMessage(
  targetId: string,
  blocker: OCCdMigrationBlocker
): string {
  switch (blocker.code) {
    case 'occd_migration_target_not_found':
      return `SSH target "${targetId}" not found.`
    case 'occd_migration_target_owned':
      return 'This SSH target is already owned by another managed runtime.'
    case 'occd_migration_owner_unrecorded':
      return 'This SSH target is held for this server, but no record explains why. Recover the server before reusing the host.'
    case 'occd_migration_direct_ssh_repositories':
    case 'occd_migration_direct_ssh_folder_workspaces':
      return 'This SSH target owns repositories or folder workspaces. OCC can only be set up on a host with no direct SSH projects yet; keep this host in direct SSH mode.'
    case 'occd_migration_direct_ssh_terminal_leases':
      return 'This SSH target still owns terminal sessions. Close them before converting the host.'
    case 'occd_migration_saved_port_forwards':
      return 'This SSH target has saved port forwards. Remove them before converting the host.'
    case 'occd_migration_dependent_state':
      return dependentStateMessage(blocker.dependencies)
    case 'occd_migration_dependency_unverifiable':
      return `OCC could not read its saved ${blocker.sources.join(', ')} state, so it cannot show this SSH target is unused; the target was left in direct SSH mode.`
  }
}
