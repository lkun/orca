import type { FolderWorkspace } from '../folder-workspaces/folder-workspace-types'
import type { Repo } from '../repo-types'
import type { SavedPortForward, SshRemotePtyLease } from '../ssh-types'

export const OCCD_MIGRATION_DEPENDENCY_KINDS = [
  'saved-port-forward',
  'terminal-lease',
  'terminal-recovery',
  'workspace-session',
  'worktree-metadata',
  'worktree-lineage',
  'workspace-lineage',
  'sparse-preset',
  'retired-worktree-name',
  'automation',
  'automation-run',
  'mobile-tab-selection',
  'ui-routing'
] as const

export type OCCdMigrationDependencyKind = (typeof OCCD_MIGRATION_DEPENDENCY_KINDS)[number]

export type OCCdMigrationDependency = {
  kind: OCCdMigrationDependencyKind
  count: number
  /** A bounded sample of what holds the reference, so the user can find and clear it. */
  names?: string[]
}

export type OCCdMigrationRepository = Pick<Repo, 'id' | 'path' | 'displayName' | 'kind'>
export type OCCdMigrationFolderWorkspace = Pick<FolderWorkspace, 'id' | 'name' | 'folderPath'>
export type OCCdMigrationTerminalLease = Pick<
  SshRemotePtyLease,
  'ptyId' | 'worktreeId' | 'tabId' | 'leafId' | 'state' | 'updatedAt'
>

export type OCCdMigrationBlocker =
  | {
      code: 'occd_migration_target_not_found'
      category: 'registration'
    }
  | {
      code: 'occd_migration_target_owned'
      category: 'exclusive-ownership'
      holder:
        | { kind: 'runtime'; runtimeId: string }
        | { kind: 'managed-server'; environmentId: string }
    }
  | {
      /** Owned by the asking environment, but no durable record of why. */
      code: 'occd_migration_owner_unrecorded'
      category: 'exclusive-ownership'
    }
  | {
      code: 'occd_migration_direct_ssh_repositories'
      category: 'drainable-static-state'
      repositories: OCCdMigrationRepository[]
    }
  | {
      code: 'occd_migration_direct_ssh_folder_workspaces'
      category: 'drainable-static-state'
      folderWorkspaces: OCCdMigrationFolderWorkspace[]
    }
  | {
      code: 'occd_migration_direct_ssh_terminal_leases'
      category: 'live-or-unverifiable'
      terminalLeases: OCCdMigrationTerminalLease[]
    }
  | {
      code: 'occd_migration_saved_port_forwards'
      category: 'client-owned-state'
      portForwards: SavedPortForward[]
    }
  | {
      code: 'occd_migration_dependent_state'
      category: 'client-owned-state'
      dependencies: OCCdMigrationDependency[]
    }
  | {
      code: 'occd_migration_dependency_unverifiable'
      category: 'live-or-unverifiable'
      sources: OCCdMigrationDependencyKind[]
    }

export type OCCdMigrationPreflight = {
  targetId: string
  targetLabel: string | null
  claimable: boolean
  blockers: OCCdMigrationBlocker[]
}
