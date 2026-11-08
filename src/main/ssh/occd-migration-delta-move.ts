/** Journal only additions made after conversion to the same server; retain the full journal chain and source rows. Stage conflicts leave the changed mark and source intact; uncertain outcomes keep the journal for resume. */
import {
  OCCD_MIGRATION_SOURCE_CUTOVER_VERSION,
  type OCCdMigrationSourceCutover
} from '../../shared/occd-migration/occd-migration-source-cutover'
import type { OCCdDeltaMoveResult } from '../../shared/occd-managed-runtime'
import { recordManagedOCCdMigration } from '../../shared/remote-runtime/host-store/runtime-environment-managed-occd-store'
import type { KnownRuntimeEnvironment } from '../../shared/remote-runtime/host-catalog/runtime-environments'
import type { SshTarget } from '../../shared/ssh-types'
import type { Store } from '../persistence/loading-store/store'
import {
  abortOCCdMigrationCutover,
  commitOCCdMigrationDestination,
  type OCCdMigrationCutoverContext,
  type OCCdMigrationDestinationCatalog
} from './occd-migration-cutover-coordinator'
import {
  findOCCdMigrationSourceCutoverForTarget,
  listOCCdMigrationCutoverChainForTarget,
  removeOCCdMigrationSourceCutover,
  writeOCCdMigrationSourceCutover
} from './occd-migration-cutover-journal'
import {
  committedOCCdMigrationChain,
  occdDeltaSourceStore,
  planOCCdDeltaMove,
  unfinishedOCCdDelta,
  type OCCdDeltaMovePlan
} from './occd-migration-delta-plan'
import { assertOCCdMigrationRequestFits } from './occd-migration-manifest-export'
import { retainOCCdMigrationSource } from './occd-migration-source-retention'
import {
  assessOCCdMigrationTerminals,
  type OCCdMigrationTerminalVerdict,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from './occd-migration-terminal-gate'
import {
  currentOCCdSourceFingerprint,
  occdCatalogFingerprint,
  unmovedOCCdSourceRows,
  withKeptOCCdSourceRows
} from './occd-retained-source'
import { collectOCCdMigrationSourceCatalog } from '../persistence/migrating-occd-catalog/occd-source-catalog'
import type { SshTargetOCCdClaims } from './targets/ssh-target-occd-claims'
import { occdMigrationRefusalReason } from './occd-migration-refusal-reason'
import { errorMessage } from '../../shared/error-message'

type OCCdDeltaMoveArgs = {
  userDataPath: string
  store: Store
  claims: SshTargetOCCdClaims
  target: SshTarget
  environment: KnownRuntimeEnvironment
  /** Build the destination after opening its tunnel: re-pairing during open can replace commit credentials. */
  connectDestination: () => Promise<OCCdMigrationDestinationCatalog>
  /** Host census proves exit or identifies terminals preserved by the legacy bridge. */
  censusHost?: CensusHostRelayTerminals | null
  /** Serialize journal-through-commit with all other lifecycle changes to this host. */
  runTargetLifecycle: <T>(targetId: string, operation: () => Promise<T>) => Promise<T>
  now?: () => Date
}

export async function runOCCdDeltaMove(args: OCCdDeltaMoveArgs): Promise<OCCdDeltaMoveResult> {
  const { userDataPath, store, target } = args
  const now = args.now ?? (() => new Date())
  const plan = planOCCdDeltaMove(userDataPath, store, target, { now })
  // Capture baseline with the manifest before awaiting so both describe the same source.
  const planned = currentOCCdSourceFingerprint(store, target)
  if (!plan.resumes && plan.added.length === 0) {
    return refuse('occd_delta_nothing_new', 'An older build added nothing new to move.')
  }
  if (plan.blockers.length > 0) {
    return {
      ...refuse('occd_migration_preflight_blocked', occdMigrationRefusalReason(plan.blockers)),
      blockers: plan.blockers
    }
  }
  if (!plan.resumes) {
    // Reject before journaling or an unsendable delta could pin the fence permanently.
    assertOCCdMigrationRequestFits({ manifest: plan.manifest })
  }
  const terminals = await assessOCCdMigrationTerminals(store, target.id, args.censusHost)
  if (terminals.verdict !== 'exited' && terminals.verdict !== 'bridged') {
    return refuse('occd_migration_terminals', terminals.reason)
  }
  const settled: SettledTerminals = terminals
  retireProvenExitedLeases(store, target.id, terminals)
  return args.runTargetLifecycle(target.id, async () => {
    // Another move may have journaled or finished while waiting for the lifecycle lock.
    const changedAt = store.getSshTarget(target.id)?.occdFence?.sourceChangedAt
    const head = findOCCdMigrationSourceCutoverForTarget(userDataPath, target.id)
    if (!changedAt || head?.migrationId !== (plan.resumes ?? plan.head).migrationId) {
      return refuse('occd_delta_superseded', 'Another move of this host ran first.')
    }
    // Source remains writable before fencing; edits during census must not silently become the manifest's baseline.
    if (!plan.resumes && planned !== currentOCCdSourceFingerprint(store, target)) {
      return refuse(
        'occd_delta_source_changed',
        'This host changed while the move was starting. Try the move again.'
      )
    }
    const cutover = plan.resumes ?? journalDelta(args, plan, planned, settled, now)
    return commitDelta(args, plan, cutover, changedAt, now)
  })
}

type SettledTerminals = Extract<OCCdMigrationTerminalVerdict, { verdict: 'exited' | 'bridged' }>

function journalDelta(
  args: OCCdDeltaMoveArgs,
  plan: OCCdDeltaMovePlan,
  planned: string,
  terminals: SettledTerminals,
  now: () => Date
): OCCdMigrationSourceCutover {
  const timestamp = now().toISOString()
  const cutover: OCCdMigrationSourceCutover = {
    version: OCCD_MIGRATION_SOURCE_CUTOVER_VERSION,
    migrationId: plan.manifest.migrationId,
    phase: 'source-fenced',
    startedAt: timestamp,
    updatedAt: timestamp,
    destinationEnvironmentId: plan.environmentId,
    destinationName: plan.head.destinationName,
    sshTargetId: args.target.id,
    sshTargetGeneration: plan.head.sshTargetGeneration,
    manifestSha256: plan.manifest.manifestSha256,
    provenPtyIds: terminals.verdict === 'exited' ? terminals.provenPtyIds : [],
    // COMPAT(legacy-relay-bridge): a move leaves relay terminals running for the bridge too.
    ...(terminals.verdict === 'bridged' ? { bridgedPtyIds: terminals.bridgedPtyIds } : {}),
    supersedesMigrationId: plan.head.migrationId,
    // Retained rows must match the whole source captured with this manifest.
    sourceBaselineFingerprint: planned,
    manifest: plan.manifest
  }
  writeOCCdMigrationSourceCutover(args.userDataPath, cutover)
  return cutover
}

async function commitDelta(
  args: OCCdDeltaMoveArgs,
  plan: OCCdDeltaMovePlan,
  cutover: OCCdMigrationSourceCutover,
  changedAt: string,
  now: () => Date
): Promise<OCCdDeltaMoveResult> {
  const { userDataPath, store, target } = args
  // Clear the changed mark and freeze source for the move.
  store.updateSshTarget(target.id, { occdFence: { environmentId: plan.environmentId } })
  await args.claims.flush()
  // Record before any new/resumed commit so rollback cannot cross the migration.
  recordManagedOCCdMigration(userDataPath, plan.environmentId, now().toISOString())
  let destination: OCCdMigrationDestinationCatalog
  try {
    destination = await args.connectDestination()
  } catch (error) {
    // No request reached the server; keep the journal for later resume.
    await restoreChangedMark(args, cutover, changedAt)
    throw error
  }
  const context: OCCdMigrationCutoverContext = {
    userDataPath,
    store: plan.source,
    freshSource: () => occdDeltaSourceStore(store, target, plan.moved, cutover.manifest),
    claims: args.claims,
    destination,
    now
  }
  try {
    const committed = await commitOCCdMigrationDestination(context, cutover.migrationId)
    if (committed.phase !== 'destination-committed' && committed.phase !== 'source-retired') {
      throw new Error(`occd_migration_commit_not_proven:${committed.phase}`)
    }
  } catch (error) {
    const released = await releaseUncommittedDelta(args, context, cutover, changedAt)
    if (released === 'released') {
      return refuse('occd_delta_refused_by_server', errorMessage(error))
    }
    if (released === 'kept') {
      throw error
    }
  }
  await retainOCCdMigrationSource(userDataPath, cutover.migrationId, store, now)
  return { outcome: 'moved', migrationId: cutover.migrationId }
}

/** Release only on proven destination absence; otherwise retain journal for resume. Restore the host's changed mark either way. */
async function releaseUncommittedDelta(
  args: OCCdDeltaMoveArgs,
  context: OCCdMigrationCutoverContext,
  cutover: OCCdMigrationSourceCutover,
  changedAt: string
): Promise<'released' | 'committed' | 'kept'> {
  const restoreMark = (): Promise<void> => restoreChangedMark(args, cutover, changedAt)
  try {
    const result = await abortOCCdMigrationCutover(context, cutover.migrationId, async () => {
      // Restore the mark first so a crash during journal removal leaves a resumable marked host.
      await restoreMark()
      removeOCCdMigrationSourceCutover(args.userDataPath, cutover.migrationId)
    })
    return result.outcome === 'released' ? 'released' : 'committed'
  } catch {
    await restoreMark()
    return 'kept'
  }
}

async function restoreChangedMark(
  args: Pick<OCCdDeltaMoveArgs, 'store' | 'claims'>,
  cutover: OCCdMigrationSourceCutover,
  changedAt: string
): Promise<void> {
  args.store.updateSshTarget(cutover.sshTargetId, {
    occdFence: { environmentId: cutover.destinationEnvironmentId, sourceChangedAt: changedAt }
  })
  await args.claims.flush()
}

/** Keep older-build changes only in retained profile rows. */
export async function keepOCCdServerVersion(args: {
  userDataPath: string
  store: Store
  claims: SshTargetOCCdClaims
  target: SshTarget
}): Promise<void> {
  const environmentId = args.target.occdFence?.environmentId
  const chain = listOCCdMigrationCutoverChainForTarget(args.userDataPath, args.target.id)
  if (unfinishedOCCdDelta(chain)) {
    // Unfinished moves may already have copied rows; only commit/abort can decide.
    throw new Error('occd_delta_move_unfinished')
  }
  const head = committedOCCdMigrationChain(chain).at(-1)
  if (!environmentId || !args.target.occdFence?.sourceChangedAt || !head) {
    throw new Error('occd_delta_not_changed')
  }
  const current = collectOCCdMigrationSourceCatalog(args.store, args.target)
  const unmoved = unmovedOCCdSourceRows(current, committedOCCdMigrationChain(chain))
  writeOCCdMigrationSourceCutover(args.userDataPath, {
    ...withKeptOCCdSourceRows(head, unmoved),
    // Explicit reconcile accepts the current retained source as the new baseline.
    sourceBaselineFingerprint: occdCatalogFingerprint(current)
  })
  args.store.updateSshTarget(args.target.id, { occdFence: { environmentId } })
  await args.claims.flush()
}

function refuse(
  code: string,
  reason: string
): Extract<OCCdDeltaMoveResult, { outcome: 'refused' }> {
  return { outcome: 'refused', code, reason }
}
