import type {
  PersistedTrustedOCCHookRepo,
  PersistedTrustedOCCHooks
} from './occ-yaml-hook-types'

export type OCCHookTrustKind = Exclude<keyof PersistedTrustedOCCHookRepo, 'all'>

export function canUseRepoWideTrust(
  trust: PersistedTrustedOCCHooks,
  repos: readonly { id: string }[],
  repoId: string
): boolean {
  // Why: with the id on two hosts, trusting one row's script could run the other's unseen.
  return Boolean(trust[repoId]?.all) && repos.filter((repo) => repo.id === repoId).length < 2
}

// Bounded, so a long-lived repo can't accumulate every script it ever had; large enough that
// switching between branches with different setup scripts rarely re-prompts.
export const MAX_APPROVED_OCC_HOOK_HASHES = 20

/** Every content hash approved for this script, newest first. */
export function approvedOCCHookContentHashes(
  trust: PersistedTrustedOCCHooks,
  repoId: string,
  kind: OCCHookTrustKind
): string[] {
  const entry: unknown = trust[repoId]?.[kind]
  if (!entry || typeof entry !== 'object') {
    return []
  }
  const latest = 'contentHash' in entry ? entry.contentHash : undefined
  const previous = 'previousContentHashes' in entry ? entry.previousContentHashes : undefined
  const hashes = [latest, ...(Array.isArray(previous) ? previous : [])].filter(
    (hash): hash is string => typeof hash === 'string' && hash.length > 0 && hash.length <= 128
  )
  return [...new Set(hashes)].slice(0, MAX_APPROVED_OCC_HOOK_HASHES)
}

export function isOCCHookContentApproved(
  trust: PersistedTrustedOCCHooks,
  repoId: string,
  kind: OCCHookTrustKind,
  contentHash: string
): boolean {
  return approvedOCCHookContentHashes(trust, repoId, kind).includes(contentHash)
}

/** Returns `trust` itself when the approval is already the latest one recorded. */
export function withOCCHookScriptConfirmed(
  trust: PersistedTrustedOCCHooks,
  repoId: string,
  kind: OCCHookTrustKind,
  contentHash: string,
  approvedAt: number = Date.now()
): PersistedTrustedOCCHooks {
  const existing = trust[repoId]
  if (existing?.[kind]?.contentHash === contentHash) {
    return trust
  }
  const previousContentHashes = approvedOCCHookContentHashes(trust, repoId, kind)
    .filter((hash) => hash !== contentHash)
    .slice(0, MAX_APPROVED_OCC_HOOK_HASHES - 1)
  return {
    ...trust,
    [repoId]: {
      ...existing,
      [kind]: {
        contentHash,
        approvedAt,
        ...(previousContentHashes.length > 0 ? { previousContentHashes } : {})
      }
    }
  }
}

/** Returns `trust` itself when the repo is already always-trusted. */
export function withOCCHookRepoAlwaysTrusted(
  trust: PersistedTrustedOCCHooks,
  repoId: string,
  approvedAt: number = Date.now()
): PersistedTrustedOCCHooks {
  const existing = trust[repoId]
  if (existing?.all) {
    return trust
  }
  return { ...trust, [repoId]: { ...existing, all: { approvedAt } } }
}
