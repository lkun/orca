import type { PersistedTrustedOCCHooks } from '../../../src/shared/occ-yaml-hook-types'
import {
  canUseRepoWideTrust,
  withOCCHookRepoAlwaysTrusted,
  withOCCHookScriptConfirmed
} from '../../../src/shared/occ-hook-trust-entries'
import type { RpcClient } from '../transport/rpc-client'
import { taskUiStateWrite } from './mobile-task-runtime-operations'

export type SetupHookTrust = {
  contentHash: string
  scriptContent: string
}

export function isSetupHookTrusted(
  trust: PersistedTrustedOCCHooks,
  repos: readonly { id: string }[],
  repoId: string,
  contentHash: string
): boolean {
  return (
    canUseRepoWideTrust(trust, repos, repoId) || trust[repoId]?.setup?.contentHash === contentHash
  )
}

export function wasSetupHookPreviouslyApproved(
  trust: PersistedTrustedOCCHooks,
  repoId: string
): boolean {
  return Boolean(trust[repoId]?.setup?.contentHash)
}

export async function persistSetupHookTrustApproval(args: {
  client: RpcClient
  trust: PersistedTrustedOCCHooks
  repoId: string
  contentHash: string
  alwaysTrust: boolean
}): Promise<PersistedTrustedOCCHooks> {
  const next = args.alwaysTrust
    ? withOCCHookRepoAlwaysTrusted(args.trust, args.repoId)
    : withOCCHookScriptConfirmed(args.trust, args.repoId, 'setup', args.contentHash)
  taskUiStateWrite.interpret(
    await taskUiStateWrite.request(args.client, { trustedOCCHooks: next })
  )
  return next
}

// Hooks may omit setupTrust; validate the pair here while preserving other host fields.
export function normalizeSetupHookTrust(
  setupTrust: { contentHash?: string; scriptContent?: string } | null | undefined
): SetupHookTrust | null {
  const contentHash = setupTrust?.contentHash
  const scriptContent = setupTrust?.scriptContent
  if (!contentHash || !scriptContent) {
    return null
  }
  return { ...setupTrust, contentHash, scriptContent }
}

// New hosts send setupConfig (occ.yaml setup plus defaultTabs commands); older ones only the effective setup script.
export function readRepoHooksSetupCommand(reply: {
  hooks?: { scripts?: { setup?: string } } | null
  setupConfig?: { command: string } | null
}): string | null {
  if (reply.setupConfig !== undefined) {
    return reply.setupConfig?.command.trim() || null
  }
  return reply.hooks?.scripts?.setup?.trim() || null
}
