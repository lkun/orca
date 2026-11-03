import { OCCD_MIGRATION_SSH_RELAY_SOURCE_KIND } from '../../shared/occd-migration/occd-migration-source-kind'
import type { SshTarget } from '../../shared/ssh-types'
import { collectOCCdMigrationSourceCatalog } from '../persistence/migrating-occd-catalog/occd-source-catalog'
import type { Store } from '../persistence/loading-store/store'
import { createOCCdMigrationManifest } from './occd-migration-manifest-export'
import { IDENTITY_OCCD_MIGRATION_PATH_REWRITER } from './occd-migration-path-rewrite'
import type {
  OCCdMigrationSource,
  OCCdMigrationSourceCutoverPort
} from './occd-migration-source'
import { assertOCCdMigrationSourceUnchanged } from './occd-migration-source-assertions'
import {
  fenceOCCdMigrationSource,
  releaseOCCdMigrationFence,
  resolveOCCdMigrationFence
} from './occd-migration-source-fence'
import {
  assessOCCdMigrationTerminals,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from './occd-migration-terminal-gate'
import type { SshTargetOCCdClaims } from './targets/ssh-target-occd-claims'
import type { OCCdMigrationPreflightStore } from './targets/ssh-target-occd-preflight'
import type { OCCdMigrationPaneLeasePredicate } from './occd-migration-bridged-panes'

type SshRelayCutoverDeps = {
  userDataPath: string
  store: OCCdMigrationPreflightStore
  claims: SshTargetOCCdClaims
  /** Rebuild copied stores for every check so later edits remain visible. */
  freshSource?: () => OCCdMigrationPreflightStore
  signal?: AbortSignal
}

export function sshRelayMigrationCutoverPort(
  deps: SshRelayCutoverDeps
): OCCdMigrationSourceCutoverPort {
  return {
    verifyFence: (cutover) =>
      assertOCCdMigrationSourceUnchanged(
        { userDataPath: deps.userDataPath, store: deps.freshSource?.() ?? deps.store },
        cutover
      ),
    releaseFence: (cutover) => releaseOCCdMigrationFence(deps, cutover)
  }
}

export function createSshRelayMigrationSource(
  deps: SshRelayCutoverDeps & {
    store: OCCdMigrationPreflightStore &
      Pick<Store, 'getSshRemotePtyLeases' | 'markSshRemotePtyLease'>
    target: SshTarget
    /** Every relay endpoint on the host's account; without it exit can never be proven. */
    censusHost?: CensusHostRelayTerminals | null
    isBridgedPaneLease?: OCCdMigrationPaneLeasePredicate
  }
): OCCdMigrationSource {
  const { userDataPath, store, target } = deps
  return {
    ...sshRelayMigrationCutoverPort(deps),
    kind: OCCD_MIGRATION_SSH_RELAY_SOURCE_KIND,
    journalKey: target.id,
    collectCatalog: () => collectOCCdMigrationSourceCatalog(store, target),
    exportManifest: (options = {}) =>
      createOCCdMigrationManifest(store, target, {
        ...options,
        rewrite: IDENTITY_OCCD_MIGRATION_PATH_REWRITER
      }),
    assessTerminals: () => assessOCCdMigrationTerminals(store, target.id, deps.censusHost),
    retireProvenExitedTerminals: (proof) => retireProvenExitedLeases(store, target.id, proof),
    resolveFence: () => resolveOCCdMigrationFence(userDataPath, target),
    acquireFence: (args) =>
      fenceOCCdMigrationSource({
        userDataPath,
        store,
        claims: deps.claims,
        targetId: target.id,
        isBridgedPaneLease: deps.isBridgedPaneLease,
        ...args
      })
  }
}
