import type { PersistedTrustedOCCHooks } from '../../../src/shared/occ-yaml-hook-types'
import {
  canUseRepoWideTrust,
  type OCCHookTrustKind,
  withOCCHookRepoAlwaysTrusted,
  withOCCHookScriptConfirmed
} from '../../../src/shared/occ-hook-trust-entries'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { taskUiStateWrite } from './mobile-task-runtime-operations'

export type SetupHookTrust = {
  contentHash: string
  scriptContent: string
}

export function isOCCHookTrusted(
  trust: PersistedTrustedOCCHooks,
  repos: readonly { id: string }[],
  repoId: string,
  kind: OCCHookTrustKind,
  contentHash: string
): boolean {
  return (
    canUseRepoWideTrust(trust, repos, repoId) || trust[repoId]?.[kind]?.contentHash === contentHash
  )
}

export function isSetupHookTrusted(
  trust: PersistedTrustedOCCHooks,
  repos: readonly { id: string }[],
  repoId: string,
  contentHash: string
): boolean {
  return isOCCHookTrusted(trust, repos, repoId, 'setup', contentHash)
}

export function wasOCCHookPreviouslyApproved(
  trust: PersistedTrustedOCCHooks,
  repoId: string,
  kind: OCCHookTrustKind
): boolean {
  return Boolean(trust[repoId]?.[kind]?.contentHash)
}

export function wasSetupHookPreviouslyApproved(
  trust: PersistedTrustedOCCHooks,
  repoId: string
): boolean {
  return wasOCCHookPreviouslyApproved(trust, repoId, 'setup')
}

type HookTrustApproval = {
  client: RpcClient
  trust: PersistedTrustedOCCHooks
  repoId: string
  contentHash: string
  alwaysTrust: boolean
}

export async function persistOCCHookTrustApproval(
  args: HookTrustApproval & { kind: OCCHookTrustKind }
): Promise<PersistedTrustedOCCHooks> {
  // Repo-wide trust is ignored when the repo id is on two hosts, so keep this script's approval too.
  const confirmed = withOCCHookScriptConfirmed(
    args.trust,
    args.repoId,
    args.kind,
    args.contentHash
  )
  const next = args.alwaysTrust ? withOCCHookRepoAlwaysTrusted(confirmed, args.repoId) : confirmed
  taskUiStateWrite.interpret(
    await taskUiStateWrite.request(args.client, { trustedOCCHooks: next })
  )
  return next
}

export function persistSetupHookTrustApproval(
  args: HookTrustApproval
): Promise<PersistedTrustedOCCHooks> {
  return persistOCCHookTrustApproval({ ...args, kind: 'setup' })
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
