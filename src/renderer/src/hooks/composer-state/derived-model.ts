import type { GitHubWorkItem } from '../../../../shared/github/work-item-types'
import type { OCCHooks, SetupRunPolicy } from '../../../../shared/occ-yaml-hook-types'
import type { SparsePreset } from '../../../../shared/worktree/create-types'
import type { RetiredNameRegistry } from '../../../../shared/worktree/retired-name-registry'
import type { GitHubLinkQuery } from '@/lib/github-links'
import type { SetupConfig } from '../../../../shared/occ-hook-setup-config'

export type ComposerDerivedModel = {
  sparsePresetsForRepo: SparsePreset[]
  sparsePresets: SparsePreset[]
  normalizedSparseDirectories: string[]
  effectivePresetId: string | null
  sparseError: string | null
  parsedLinkedIssueNumber: number | null
  effectiveLinkedPR: number | null
  currentYamlHooks: OCCHooks | null
  setupConfig: SetupConfig | null
  setupPolicy: SetupRunPolicy
  linkedWorkItemProvider: 'github' | 'gitlab' | 'linear' | 'jira' | null
  requiresExplicitSetupChoice: boolean
  resolvedSetupDecision: 'skip' | 'run' | null
  isSetupCheckPending: boolean
  shouldWaitForSetupCheck: boolean
  retiredNamesRefreshKey: string
  retiredWorktreeNames: RetiredNameRegistry
  fallbackCreatureName: string
  workspaceSeedName: string
  shouldApplyLinkedOnlyTemplate: boolean
  linkedOnlyTemplatePrompt: string
  normalizedLinkQuery: GitHubLinkQuery
  filteredLinkItems: GitHubWorkItem[]
}
