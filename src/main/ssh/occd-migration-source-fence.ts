/** Persist journal, fence, then profile flush before remote calls. Crashes may leave a non-authoritative stale journal; a fence without a journal requires destination evidence before release. */
import { randomUUID } from 'node:crypto'
import { getManagedOCCdFenceEnvironmentId } from '../../shared/managed-occd-ssh-owner'
import type { OCCdMigrationBlocker } from '../../shared/occd-migration/occd-migration-preflight'
import {
  OCCD_MIGRATION_SOURCE_CUTOVER_VERSION,
  type OCCdMigrationSourceCutover
} from '../../shared/occd-migration/occd-migration-source-cutover'
import type { SshTarget } from '../../shared/ssh-types'
import {
  assertOCCdMigrationRequestFits,
  createOCCdMigrationManifest
} from './occd-migration-manifest-export'
import {
  findOCCdMigrationSourceCutoverForTarget,
  removeOCCdMigrationSourceCutover,
  writeOCCdMigrationSourceCutover
} from './occd-migration-cutover-journal'
import {
  confirmOCCdMigrationTerminalsUnderFence,
  type OCCdMigrationTerminalVerdict
} from './occd-migration-terminal-gate'
import type { SshTargetOCCdClaims } from './targets/ssh-target-occd-claims'
import {
  isBlockingOCCdMigrationBlocker,
  preflightOCCdMigrationExport,
  type OCCdMigrationPreflightStore
} from './targets/ssh-target-occd-preflight'
import { occdMigrationRefusalReason } from './occd-migration-refusal-reason'
import {
  preservesOCCdMigrationBridgedPanes,
  type OCCdMigrationPaneLeasePredicate
} from './occd-migration-bridged-panes'

export const OCCD_MIGRATION_LEAVE_BEHIND_TERMINALS = 'occd_migration_leave_behind_terminals'
export const OCCD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON =
  'Move anyway needs every terminal on this host closed first, and OCC could not confirm they all exited. Close them, or end them on the host, then connect again.'

export type OCCdMigrationFenceState =
  | { state: 'none' }
  | { state: 'fenced'; cutover: OCCdMigrationSourceCutover }
  /** Empty-host deploys record provisioning intent instead of a migration journal. */
  | { state: 'owned-by-deploy'; environmentId: string }
  /** Unexplained ownership requires recovery, never automatic release. */
  | { state: 'fenced-unverifiable'; environmentId: string }
  /** Stale journals grant no staging authority. */
  | { state: 'stale-journal'; cutover: OCCdMigrationSourceCutover }

/** Throws when the journal cannot be read: an unreadable record keeps the host fenced. */
export function resolveOCCdMigrationFence(
  userDataPath: string,
  target: SshTarget
): OCCdMigrationFenceState {
  const cutover = findOCCdMigrationSourceCutoverForTarget(userDataPath, target.id)
  const ownerEnvironmentId = getManagedOCCdFenceEnvironmentId(target)
  if (cutover) {
    return ownerEnvironmentId === cutover.destinationEnvironmentId &&
      target.generation === cutover.sshTargetGeneration
      ? { state: 'fenced', cutover }
      : { state: 'stale-journal', cutover }
  }
  if (!ownerEnvironmentId) {
    return { state: 'none' }
  }
  return target.occdProvisioning
    ? { state: 'owned-by-deploy', environmentId: ownerEnvironmentId }
    : { state: 'fenced-unverifiable', environmentId: ownerEnvironmentId }
}

export type OCCdMigrationFenceResult =
  | { outcome: 'fenced'; cutover: OCCdMigrationSourceCutover; resumed: boolean }
  | {
      outcome: 'refused'
      verdict: 'live' | 'unverifiable'
      code: string
      reason: string
      blockers?: OCCdMigrationBlocker[]
    }

export async function fenceOCCdMigrationSource(args: {
  userDataPath: string
  store: OCCdMigrationPreflightStore
  claims: SshTargetOCCdClaims
  targetId: string
  destinationEnvironmentId: string
  destinationName: string
  terminalProof: OCCdMigrationTerminalVerdict
  isBridgedPaneLease?: OCCdMigrationPaneLeasePredicate
  now?: () => Date
  signal?: AbortSignal
}): Promise<OCCdMigrationFenceResult> {
  const target = args.store.getSshTarget(args.targetId)
  if (!target) {
    return refuse('unverifiable', 'occd_migration_target_not_found', 'The SSH host is gone.')
  }
  const existing = resolveOCCdMigrationFence(args.userDataPath, target)
  if (existing.state === 'fenced') {
    return existing.cutover.destinationEnvironmentId === args.destinationEnvironmentId
      ? { outcome: 'fenced', cutover: existing.cutover, resumed: true }
      : refuse('live', 'occd_migration_in_progress', 'Another migration holds this SSH host.')
  }
  if (existing.state !== 'none') {
    return refuse(
      'unverifiable',
      `occd_migration_${existing.state.replaceAll('-', '_')}`,
      fenceStateReason(existing)
    )
  }
  const proof = args.terminalProof
  if (proof.verdict !== 'exited' && proof.verdict !== 'bridged') {
    return refuse(proof.verdict, 'occd_migration_terminals', proof.reason)
  }
  const preflight = preflightOCCdMigrationExport(
    args.store,
    target.id,
    undefined,
    proof.verdict === 'bridged' ? proof.bridgedPtyIds : []
  )
  if (!preflight.claimable) {
    return {
      ...refuse(
        // Only a proven blocker reads live; one that is merely unanswered stays unverifiable.
        preflight.blockers
          .filter(isBlockingOCCdMigrationBlocker)
          .every((blocker) => blocker.category === 'live-or-unverifiable')
          ? 'unverifiable'
          : 'live',
        'occd_migration_preflight_blocked',
        occdMigrationRefusalReason(preflight.blockers)
      ),
      blockers: preflight.blockers
    }
  }
  const generation = args.claims.ensureGeneration(target.id)
  const now = (args.now ?? (() => new Date()))().toISOString()
  const manifest = createOCCdMigrationManifest(
    args.store,
    { ...target, generation },
    { migrationId: randomUUID(), destinationEnvironmentId: args.destinationEnvironmentId }
  )
  if (
    proof.verdict === 'bridged' &&
    target.managedServerLeaveBehind &&
    !preservesOCCdMigrationBridgedPanes(
      manifest.payload,
      args.store.getSshRemotePtyLeases(target.id),
      proof.bridgedPtyIds,
      args.isBridgedPaneLease
    )
  ) {
    return refuse(
      proof.relayVerdict,
      OCCD_MIGRATION_LEAVE_BEHIND_TERMINALS,
      OCCD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON
    )
  }
  // Reject before journaling so an unsendable manifest cannot pin the fence.
  assertOCCdMigrationRequestFits({ manifest })
  const cutover: OCCdMigrationSourceCutover = {
    version: OCCD_MIGRATION_SOURCE_CUTOVER_VERSION,
    migrationId: manifest.migrationId,
    phase: 'source-fenced',
    startedAt: now,
    updatedAt: now,
    destinationEnvironmentId: args.destinationEnvironmentId,
    destinationName: args.destinationName,
    sshTargetId: target.id,
    sshTargetGeneration: generation,
    manifestSha256: manifest.manifestSha256,
    provenPtyIds: proof.verdict === 'exited' ? proof.provenPtyIds : [],
    ...(proof.verdict === 'bridged' ? { bridgedPtyIds: proof.bridgedPtyIds } : {}),
    // Capture before commit; this journaled export is the evidence of what the destination receives.
    manifest
  }
  writeOCCdMigrationSourceCutover(args.userDataPath, cutover)
  args.claims.fenceForMigration(target.id, args.destinationEnvironmentId, generation)
  await args.claims.flush(args.signal)
  // Recheck under fence for terminals started after the original proof.
  const underFence = confirmOCCdMigrationTerminalsUnderFence(
    args.store,
    target.id,
    args.terminalProof
  )
  if (underFence.verdict !== 'exited' && underFence.verdict !== 'bridged') {
    await releaseUnstagedFence(args, cutover)
    return refuse(underFence.verdict, 'occd_migration_terminals', underFence.reason)
  }
  return { outcome: 'fenced', cutover, resumed: false }
}

type FenceReleaseArgs = { userDataPath: string; claims: SshTargetOCCdClaims; signal?: AbortSignal }

async function releaseUnstagedFence(
  args: FenceReleaseArgs,
  cutover: OCCdMigrationSourceCutover
): Promise<void> {
  if (cutover.phase !== 'source-fenced') {
    throw new Error('occd_migration_fence_release_after_stage')
  }
  await releaseOCCdMigrationFence(args, cutover)
}

/** Drop owner before journal so an interrupted release leaves a harmless stale journal, never unexplained ownership. */
export async function releaseOCCdMigrationFence(
  args: FenceReleaseArgs,
  cutover: OCCdMigrationSourceCutover
): Promise<void> {
  args.claims.release(cutover.sshTargetId, cutover.destinationEnvironmentId)
  await args.claims.flush(args.signal)
  removeOCCdMigrationSourceCutover(args.userDataPath, cutover.migrationId)
}

/** Unregistered destinations could stage nothing; registered destinations must prove durable abort instead. */
export async function releaseUndeployedMigrationFence(args: {
  userDataPath: string
  claims: SshTargetOCCdClaims
  targetId: string
  isDestinationRegistered: (environmentId: string) => boolean
  signal?: AbortSignal
}): Promise<'released' | 'none'> {
  const cutover = findOCCdMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  if (!cutover) {
    return 'none'
  }
  if (args.isDestinationRegistered(cutover.destinationEnvironmentId)) {
    throw new Error('occd_migration_destination_registered')
  }
  await releaseUnstagedFence(args, cutover)
  return 'released'
}

function fenceStateReason(state: OCCdMigrationFenceState): string {
  switch (state.state) {
    case 'owned-by-deploy':
      return 'OCC already runs on this SSH host.'
    case 'fenced-unverifiable':
      return 'This SSH host is held for a migration whose record is missing. Recover it from this host’s OCC server first.'
    case 'stale-journal':
      return 'A migration record names this SSH host but its fence is gone. Resolve that migration first.'
    case 'fenced':
    case 'none':
      return 'This SSH host is not in a state a migration can start from.'
  }
}

function refuse(
  verdict: 'live' | 'unverifiable',
  code: string,
  reason: string
): Extract<OCCdMigrationFenceResult, { outcome: 'refused' }> {
  return { outcome: 'refused', verdict, code, reason }
}
