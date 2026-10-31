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

/** Returns `trust` itself when the approval is already recorded. */
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
  return { ...trust, [repoId]: { ...existing, [kind]: { contentHash, approvedAt } } }
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
