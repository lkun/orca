// Lock before profile load to prevent concurrent writers; terminal daemons own separate endpoints
// and deliberately survive runtime lock release and restart.
import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import {
  compareOCCdProcessIdentity,
  readOCCdProcessIncarnation,
  readOCCdProcessName,
  readOCCdProcessStartedAtMs,
  type OCCdProcessIdentityVerdict,
  type OCCdProcessIncarnation
} from './occd-process-start-time'
import {
  assertOCCdDataRootIsPrivate,
  OCCdInstanceLockError,
  type OCCdDataRootPrivacyHooks
} from './occd-data-root-privacy'
import { hasErrorCode, isProcessAlive } from '../daemon/endpoint/identity/daemon-process-inspection'
import { profileStateAccessMachineIdentity } from '../persistence/profile-state/profile-state-access-identity'
import { occdDataRootIsOnLocalDisk } from './occd-data-root-locality'
import type { OCCdReclaimHintRuntime } from '../../shared/occd-stale-lock-reclaim'
import { reclaimedUnexpectedExit } from './occd-unexpected-exit'
import type { OCCdUnexpectedExit } from '../../shared/occd-unexpected-exit'
import {
  occdLockHolderLocality,
  occdLockHolderUnverifiableError
} from './occd-lock-holder-locality'
import {
  occdLockPeer,
  occdLockSelf,
  occdPeerIsLiveCloneMachine
} from './occd-lock-clone-machine'
import {
  MAX_OCCD_LOCK_BYTES,
  readBoundedLockFile,
  reclaimAndPublish,
  unlinkQuietly,
  type OCCdLockRecoveryOwner
} from './occd-instance-lock-reclaim'
import {
  describeLockHolder,
  parseOCCdInstanceLockRecord,
  type OCCdLockRecord
} from './occd-instance-lock-record'
import { holdOCCdInstanceLock, type OCCdInstanceLock } from './occd-instance-lock-hold'

export {
  parseOCCdInstanceLockRecord,
  readOCCdInstanceLockRecord,
  type OCCdLockRecord
} from './occd-instance-lock-record'
export type { OCCdInstanceLock } from './occd-instance-lock-hold'

export const OCCD_LOCK_FILE_NAME = 'occd.lock'
// Allow old torn writes time to complete before treating garbled records as abandoned.
const GARBLED_LOCK_GRACE_MS = 10_000

export type OCCdInstanceLockHooks = OCCdDataRootPrivacyHooks & {
  identity?: () => string
  version?: () => string
  now?: () => Date
  /** EPERM still proves the process exists. */
  processIsAlive?: (pid: number) => boolean
  startedAtMs?: (pid: number) => number | null
  incarnation?: (pid: number) => OCCdProcessIncarnation | null
  ownerUid?: (pid: number) => number | null
  processName?: (pid: number) => string | null
  /** Only differs can reject a live PID’s identity. */
  holderIdentity?: (record: OCCdLockRecord) => OCCdProcessIdentityVerdict
  /** Desktop callers must first hold Electron’s single-instance lock to reclaim desktop records. */
  role?: 'occd' | 'desktop'
  machineIdentity?: () => string | null
  /** Establishes locality for legacy machine-less records. */
  dataRootIsOnLocalDisk?: (dataRoot: string) => boolean
  /** Explicit stale-reclaim confirmation permits judging otherwise unverifiable PIDs locally. */
  reclaimConfirmed?: (record: OCCdLockRecord, role: 'holder' | 'recovery-owner') => boolean
  reclaimHintRuntime?: OCCdReclaimHintRuntime | null
  bootStartedAtMs?: () => number | null
  /** Another process now holds the lock, so this one no longer has the data root to itself. */
  onExclusivityLost?: () => void
}

function defaultIdentity(): string {
  // POSIX names can repeat across containers; filesystem permissions enforce numeric UIDs.
  return process.platform === 'win32'
    ? (userInfo().username ?? 'unknown')
    : String(process.getuid?.() ?? 'unknown')
}

/** Reclaim dead holders only; preserve live or foreign-identity ownership. */
export function acquireOCCdInstanceLock(
  dataRoot: string,
  hooks: OCCdInstanceLockHooks = {}
): OCCdInstanceLock {
  const identity = (hooks.identity ?? defaultIdentity)()
  const isAlive = hooks.processIsAlive ?? isProcessAlive
  const readStartedAt = hooks.startedAtMs ?? readOCCdProcessStartedAtMs
  const readIncarnation = hooks.incarnation ?? readOCCdProcessIncarnation
  const holderIdentity =
    hooks.holderIdentity ??
    ((holder: OCCdLockRecord) =>
      compareOCCdProcessIdentity(holder.pid, holder, {
        startedAtMs: readStartedAt,
        incarnation: readIncarnation,
        ownerUid: hooks.ownerUid,
        platform: hooks.platform
      }))

  try {
    mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
  } catch (error) {
    throw new OCCdInstanceLockError(
      'occd_data_root_unusable',
      `Cannot create the occd data root ${dataRoot}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  // Desktop profiles retain existing permissions; occd tightens its own roots.
  if ((hooks.role ?? 'occd') === 'occd') {
    assertOCCdDataRootIsPrivate(dataRoot, hooks)
  }

  const lockPath = join(dataRoot, OCCD_LOCK_FILE_NAME)
  const machineIdentity = (hooks.machineIdentity ?? profileStateAccessMachineIdentity)()
  const record: OCCdLockRecord = {
    pid: process.pid,
    startedAtMs: readStartedAt(process.pid),
    ...readIncarnation(process.pid),
    identity,
    version: (hooks.version ?? (() => process.env.OCC_VERSION ?? 'unknown'))(),
    acquiredAt: (hooks.now ?? (() => new Date()))().toISOString(),
    nonce: randomUUID(),
    role: hooks.role ?? 'occd',
    ...(machineIdentity ? { machineIdentity } : {}),
    host: hostname()
  }
  const serialized = JSON.stringify(record)
  const platform = hooks.platform ?? process.platform
  const self = occdLockSelf(record, Date.parse(record.acquiredAt), hooks.bootStartedAtMs?.())

  // Stage then hard-link so canonical records are always complete.
  const publish = (): boolean => {
    const staged = `${lockPath}.staged-${process.pid}-${randomUUID()}`
    try {
      writeFileSync(staged, serialized, { flag: 'wx', mode: 0o600 })
      linkSync(staged, lockPath)
      return true
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) {
        return false
      }
      throw new OCCdInstanceLockError(
        'occd_data_root_unusable',
        `Cannot write the occd instance lock ${lockPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      unlinkQuietly(staged)
    }
  }

  const lockFor = (previousUnexpectedExit: OCCdUnexpectedExit | null = null): OCCdInstanceLock =>
    holdOCCdInstanceLock(lockPath, record, publish, {
      previousUnexpectedExit,
      onExclusivityLost: hooks.onExclusivityLost ?? (() => {})
    })
  if (publish()) {
    return lockFor()
  }

  const dataRootIsLocal = (): boolean =>
    (hooks.dataRootIsOnLocalDisk ?? occdDataRootIsOnLocalDisk)(dataRoot)
  const judgedHere = (holder: OCCdLockRecord, role: 'holder' | 'recovery-owner'): boolean => {
    const peer = occdLockPeer(holder, role === 'holder' ? lockPath : null)
    const locality = occdLockHolderLocality(peer, self, dataRootIsLocal, platform)
    return (
      locality === 'local' || (locality === 'unknown' && !!hooks.reclaimConfirmed?.(holder, role))
    )
  }
  const recoveryOwner: OCCdLockRecoveryOwner = {
    record: serialized,
    exited: (ownerRecord) => {
      const owner = parseOCCdInstanceLockRecord(ownerRecord)
      return Boolean(
        owner &&
        owner.identity === identity &&
        judgedHere(owner, 'recovery-owner') &&
        (!isAlive(owner.pid) || holderIdentity(owner) === 'differs')
      )
    }
  }

  const existingContents = readBoundedLockFile(lockPath)
  if (existingContents === null) {
    // Unreadable records cannot prove their holder exited.
    throw new OCCdInstanceLockError(
      'occd_instance_lock_unreadable',
      `The occd instance lock at ${lockPath} is unreadable or larger than ` +
        `${MAX_OCCD_LOCK_BYTES} bytes. Refusing to reclaim it without proof that its holder ` +
        'has exited. Stop occd and remove the stale lock manually.'
    )
  }
  const existing = parseOCCdInstanceLockRecord(existingContents)
  if (!existing) {
    // Old torn writes become reclaimable only after the writer grace period.
    if (garbledLockIsAbandoned(lockPath)) {
      reclaimAndPublish(lockPath, dataRoot, existingContents, publish, recoveryOwner)
      return lockFor()
    }
    throw new OCCdInstanceLockError(
      'occd_instance_lock_held',
      `The occd instance lock at ${lockPath} is still being written by another process. Retry.`
    )
  }
  if (existing.identity !== identity) {
    throw new OCCdInstanceLockError(
      'occd_instance_lock_foreign_identity',
      `The occd data root ${dataRoot} is locked by identity ${existing.identity} (pid ` +
        `${existing.pid}); this process runs as ${identity}. Two identities sharing one data ` +
        'root corrupts it. Give each its own OCC_USER_DATA.'
    )
  }
  const holder = occdLockPeer(existing, lockPath)
  if (!judgedHere(existing, 'holder')) {
    // Foreign/unverifiable PIDs prove neither absence nor reuse here.
    throw occdLockHolderUnverifiableError({
      holder: `${describeLockHolder(existing)} (pid ${existing.pid}, started ${existing.acquiredAt})`,
      foreign: occdLockHolderLocality(holder, self, dataRootIsLocal, platform) === 'foreign',
      ...(occdPeerIsLiveCloneMachine(holder, self, dataRootIsLocal, platform)
        ? { cloneMachine: { role: hooks.role ?? 'occd' } }
        : {}),
      dataRoot,
      lockPath,
      hintRuntime:
        hooks.reclaimHintRuntime !== undefined
          ? hooks.reclaimHintRuntime
          : hooks.role === 'desktop'
            ? null
            : { execPath: process.execPath, entry: process.argv[1] }
    })
  }
  // Electron’s already-held lock proves other desktop instances absent despite PID reuse.
  const staleDesktopRecord = hooks.role === 'desktop' && existing.role === 'desktop'
  const verdict = staleDesktopRecord || !isAlive(existing.pid) ? null : holderIdentity(existing)
  if (verdict === 'unproven' && !existing.bootId) {
    throw possiblyReusedPidError(lockPath, existing, hooks.processName ?? readOCCdProcessName)
  }
  if (verdict !== null && verdict !== 'differs') {
    throw new OCCdInstanceLockError(
      'occd_instance_lock_held',
      `${describeLockHolder(existing)} (pid ${existing.pid}, started ` +
        `${existing.acquiredAt || 'unknown'}) already owns the data root ${dataRoot}. Stop it ` +
        'before starting another, or use a different OCC_USER_DATA.'
    )
  }
  reclaimAndPublish(lockPath, dataRoot, existingContents, publish, recoveryOwner)
  return lockFor(reclaimedUnexpectedExit(existing, record, self.bootStartedAtMs))
}

function possiblyReusedPidError(
  lockPath: string,
  existing: OCCdLockRecord,
  processName: (pid: number) => string | null
): OCCdInstanceLockError {
  const name = processName(existing.pid)
  const holder = existing.role === 'desktop' ? 'the OCC desktop app' : 'occd'
  return new OCCdInstanceLockError(
    'occd_instance_lock_held',
    `The occd instance lock at ${lockPath} names pid ${existing.pid}, which is still running ` +
      `(as ${name ? `"${name}"` : 'an unknown program'}). This lock, written by ${holder} at ` +
      `${existing.acquiredAt}, does not record which boot it came from, so OCC cannot tell ` +
      `whether that process is still ${holder} or an unrelated program that reused the PID. ` +
      `If you are sure ${holder} is not running for this data root, delete ${lockPath} and ` +
      'try again, or use a different OCC_USER_DATA.'
  )
}

function garbledLockIsAbandoned(lockPath: string): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > GARBLED_LOCK_GRACE_MS
  } catch {
    return false
  }
}
