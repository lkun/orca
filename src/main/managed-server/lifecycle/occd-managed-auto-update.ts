import {
  planManagedOCCdAutoUpdate,
  type ManagedOCCdAutoUpdateSkip
} from './occd-managed-update-decision'
import { materializeOCCdArtifact } from '../../occd/occd-artifact-materializer'
import {
  OCCdArtifactsUnavailableError,
  OCCdHostUnsupportedError
} from '../../occd/occd-host-unavailable'
import { findIncompleteManagedOCCdMigration } from './occd-managed-migration-status'
import { OCCD_ACTIVATION_FENCE_BUSY_CODE } from '../activation/occd-activation-fence-hold'
import { resolveLinkedOCCdContext } from './occd-managed-runtime-context'
import {
  runManagedOCCdUpdate,
  withManagedOCCdLifecycle
} from '../../ssh/occd-runtime-maintenance'
import type { OCCdUpdateDeferCode } from '../../ssh/occd-update-plan'
import { readLocalFullVersion } from '../install/remote-versioned-install'

export type ManagedOCCdAutoUpdateOutcome =
  | { outcome: 'skipped'; reason: ManagedOCCdAutoUpdateSkip }
  | { outcome: 'updated'; activeVersion: string }
  | { outcome: 'deferred'; code: string; reason: string }
  /** Candidate rejection or update failure; consult host state before assuming the incumbent serves. */
  | { outcome: 'failed'; reason: string }

const WAITING_CODES: ReadonlySet<string> = new Set<
  OCCdUpdateDeferCode | typeof OCCD_ACTIVATION_FENCE_BUSY_CODE
>([
  OCCD_ACTIVATION_FENCE_BUSY_CODE,
  'occd_update_terminals_running',
  'occd_update_terminal_census_unavailable',
  'occd_update_strands_live_terminals',
  'occd_update_daemon_protocol_unverifiable',
  'occd_update_ends_in_process_terminals'
])

/** Temporary deferrals retry on later connects; interrupted activations require recovery. */
export function isWaitingOCCdUpdateDeferral(code: string): boolean {
  return WAITING_CODES.has(code)
}

export function autoUpdateManagedOCCdEnvironment(
  userDataPath: string,
  args: {
    environmentId: string
    appVersion: string
    /** Read under the lifecycle lock to observe prior overlapping attempts. */
    failedBefore: () => boolean
    onUpdating: () => void
  }
): Promise<ManagedOCCdAutoUpdateOutcome> {
  return withManagedOCCdLifecycle(userDataPath, args.environmentId, async (managed) => {
    // Restarting during migration would race cutover staging.
    if (findIncompleteManagedOCCdMigration(userDataPath, managed.environment.id)) {
      return { outcome: 'skipped', reason: 'migrating' }
    }
    const context = await resolveLinkedOCCdContext(managed.environment, managed.deployment)
    const candidateVersion = await bundledManagedOCCdVersion(context.serverTarget)
    const plan = planManagedOCCdAutoUpdate({
      record: context.activationRecord,
      candidateVersion,
      appVersion: args.appVersion,
      failedBefore: args.failedBefore()
    })
    if (plan.action === 'skip') {
      return { outcome: 'skipped', reason: plan.reason }
    }
    args.onUpdating()
    let lockedSkip: ManagedOCCdAutoUpdateSkip | null = null
    try {
      const result = await runManagedOCCdUpdate(userDataPath, managed, context, {
        // Another desktop may activate or stop a newer build during upload; recheck under the fence.
        admitRecord: (record) => {
          const locked = planManagedOCCdAutoUpdate({
            record,
            candidateVersion,
            appVersion: args.appVersion,
            failedBefore: false
          })
          if (locked.action === 'update') {
            return null
          }
          lockedSkip = locked.reason
          return `Auto-update skipped under the host fence: ${locked.reason}.`
        }
      })
      if (lockedSkip) {
        return { outcome: 'skipped', reason: lockedSkip }
      }
      if (result.outcome !== 'deferred') {
        return { outcome: 'updated', activeVersion: result.activeVersion }
      }
      return isWaitingOCCdUpdateDeferral(result.code)
        ? { outcome: 'deferred', code: result.code, reason: result.reason }
        : { outcome: 'failed', reason: result.reason }
    } catch (error) {
      return { outcome: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
  })
}

type OCCdTarget = Parameters<typeof materializeOCCdArtifact>[0]

// Packaged templates cannot change during this session; avoid repeated hashing.
const bundledVersions = new Map<OCCdTarget, Promise<string | null>>()

/** This build's occd version for `target`; null when the build bundles none for it. */
export function bundledManagedOCCdVersion(target: OCCdTarget): Promise<string | null> {
  let version = bundledVersions.get(target)
  if (!version) {
    version = materializeOCCdArtifact(target).then(readLocalFullVersion, (error: unknown) => {
      if (
        error instanceof OCCdHostUnsupportedError ||
        error instanceof OCCdArtifactsUnavailableError
      ) {
        return null
      }
      throw error
    })
    // A transient local failure must not stick for the session.
    version.catch(() => bundledVersions.delete(target))
    bundledVersions.set(target, version)
  }
  return version
}

export function resetBundledOCCdVersionsForTests(): void {
  bundledVersions.clear()
}
