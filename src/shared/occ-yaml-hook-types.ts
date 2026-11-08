export type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'
export type SetupAgentStartupPolicy = 'start-immediately' | 'wait-for-setup'
export type HookCommandSourcePolicy = 'shared-only' | 'local-only' | 'run-both'

export type OCCHooks = {
  scripts: {
    setup?: string // Runs after worktree is created
    archive?: string // Runs before worktree is archived
  }
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  issueCommand?: string // Shared default command for linked GitHub issues
  defaultTabs?: OCCDefaultTabTemplate[] // Terminal tabs to create once for a new worktree
  environmentRecipes?: OCCVmRecipe[] // Project-scoped per-workspace environment recipes
  environmentRecipeDiagnostics?: OCCVmRecipeDiagnostic[] // Non-fatal validation issues from environmentRecipes
  worktree?: OCCWorktreeDefaults // Project-scoped defaults applied when a worktree is created
}

export type OCCWorktreeDefaults = {
  // Share large rebuildable directories such as node_modules across worktrees instead of copying installs.
  sharedDirectories?: string[]
}

export type OCCDefaultTabTemplate = {
  title?: string
  color?: string
  command?: string
}

export type EphemeralVmCheckoutMode = 'occ-worktree' | 'provisioned-root'

export type OCCVmRecipe = {
  id: string
  name: string
  create: string
  checkoutMode?: EphemeralVmCheckoutMode
  description?: string
  suspend?: string
  resume?: string
  destroy?: string
  destroyDisabled?: boolean
}

export type OCCVmRecipeDiagnostic = {
  index: number
  field?: string
  message: string
}

export type RepoHookSettings = {
  // Retain the old hook-UI mode so persisted state reads without migration.
  mode: 'auto' | 'override'
  setupRunPolicy?: SetupRunPolicy
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  commandSourcePolicy?: HookCommandSourcePolicy
  scripts: {
    setup: string
    archive: string
  }
}

export type PersistedTrustedOCCHookEntry = {
  contentHash: string
  approvedAt: number
  /** Earlier approvals, newest first, so switching between branches' scripts doesn't re-prompt. */
  previousContentHashes?: string[]
}

export type PersistedTrustedOCCHookRepo = {
  all?: {
    approvedAt: number
  }
  setup?: PersistedTrustedOCCHookEntry
  archive?: PersistedTrustedOCCHookEntry
  issueCommand?: PersistedTrustedOCCHookEntry
  vmRecipe?: PersistedTrustedOCCHookEntry
}

export type PersistedTrustedOCCHooks = Record<string, PersistedTrustedOCCHookRepo>
