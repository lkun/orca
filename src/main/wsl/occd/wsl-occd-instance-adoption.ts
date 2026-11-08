/** Adopt serving unrecorded occd under the activation fence only when lock, readiness and installed build identify the same process. Never kill it without census; launching another loses the instance lock. Normal update admission handles version changes. */
import {
  OCCD_LOCK_FILE_NAME,
  parseOCCdInstanceLockRecord,
  type OCCdLockRecord
} from '../../occd/occd-instance-lock'
import { compareOCCdProcessIdentity } from '../../occd/occd-process-start-time'
import type { OCCdActivationRecord } from '../../managed-server/activation/occd-activation-record'
import {
  readOCCdActivationRecord,
  writeOCCdActivationRecord
} from '../../managed-server/activation/occd-activation-record-store'
import { evaluateOCCdActivation } from '../../managed-server/activation/occd-activation-gate'
import { withOCCdActivationLock } from '../../managed-server/activation/occd-activation-lock'
import { sameOCCdActivationRecord } from '../../managed-server/activation/occd-activation-transaction'
import { readOCCdActivationTransaction } from '../../managed-server/activation/occd-activation-transaction-store'
import { readRemoteOCCdManagedStopTarget } from '../../managed-server/lifecycle/occd-managed-remote-stop'
import {
  occdSlotDir,
  resolveOCCdSlotIdentity,
  type OCCdSlotOptions
} from '../../ssh/occd-recovery-slot'
import { OCCD_PID_FILENAME } from '../../managed-server/install/occd-remote-host-support'
import {
  parseOCCdReadinessWaitOutput,
  readOCCdReadinessNowCommand
} from '../../managed-server/install/occd-remote-readiness-wait'
import { readBoundedOCCdRemoteRecord } from '../../managed-server/install/occd-remote-record-file'
import { execOCCdRemote } from '../../managed-server/install/occd-remote-runtime-control'
import {
  OCCD_INSTALL_MODEL,
  remoteInstallDirName,
  remoteInstallVersionDirRegex
} from '../../managed-server/install/remote-install-model'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { joinRemotePath } from '../../ssh/ssh-remote-platform'
import {
  readWslGuestIdentity,
  wslGuestOCCdIncarnation,
  type WslGuestIdentity
} from '../execution/wsl-guest-process-identity'
import type { WslOCCdInstanceLockRead } from './wsl-occd-connect-state-snapshot'

const LOCK_RECORD_MAX_BYTES = 64 * 1024
const UNRECORDED_OCCD_CODE = 'wsl_occd_unrecorded_instance_unverifiable'

export type WslOCCdAdoption =
  | { outcome: 'none' }
  | { outcome: 'adopted'; version: string; pid: number; record: OCCdActivationRecord }

export class WslOCCdUnrecordedInstanceError extends Error {
  readonly code = UNRECORDED_OCCD_CODE
  constructor(message: string) {
    super(message)
    this.name = 'WslOCCdUnrecordedInstanceError'
  }
}

type LockHolder = { pid: number; version: string }

async function readLiveLockHolder(
  slot: OCCdSlotOptions,
  preRead?: WslOCCdInstanceLockRead
): Promise<LockHolder | null> {
  const lockPath = joinRemotePath(slot.host, slot.userDataDir, OCCD_LOCK_FILE_NAME)
  const read =
    preRead ?? (await readBoundedOCCdRemoteRecord(slot, lockPath, LOCK_RECORD_MAX_BYTES))
  const lock = read.state === 'present' ? parseOCCdInstanceLockRecord(read.raw) : null
  // Desktop-role or malformed locks identify no occd to adopt.
  if (!lock || lock.role === 'desktop') {
    return null
  }
  // Adopt only proven-live holders; otherwise let the host's instance lock arbitrate launch.
  // The snapshot's identity counts only if it was read for this same pid.
  const known =
    preRead?.state === 'present' && preRead.holder?.pid === lock.pid ? preRead.holder.guest : null
  return (await lockHolderLiveness(slot, lock, known)) === 'live'
    ? { pid: lock.pid, version: lock.version }
    : null
}

type LockHolderLiveness = 'live' | 'unverifiable' | 'exited'

/** A PID is no identity after a distro restart reuses it: the lock's boot id and start ticks are. */
async function lockHolderLiveness(
  slot: OCCdSlotOptions,
  lock: OCCdLockRecord,
  known: WslGuestIdentity | null = null
): Promise<LockHolderLiveness> {
  const guest = known ?? (await readWslGuestIdentity(slot.conn, lock.pid))
  if (!guest) {
    return 'unverifiable'
  }
  const incarnation = wslGuestOCCdIncarnation(guest)
  // The guest answered, and no process has that PID.
  if (!incarnation) {
    return 'exited'
  }
  // Compare boot IDs case-insensitively because readers normalize them.
  const recorded = lock.bootId ? { ...lock, bootId: lock.bootId.toLowerCase() } : lock
  const verdict = compareOCCdProcessIdentity(lock.pid, recorded, {
    incarnation: () => incarnation,
    // Ignore wall-clock starts: guest clocks jump after host sleep.
    startedAtMs: () => null,
    platform: 'linux'
  })
  return verdict === 'matches' ? 'live' : verdict === 'differs' ? 'exited' : 'unverifiable'
}

async function readSlotPid(slot: OCCdSlotOptions, version: string): Promise<number | null> {
  const pidFile = joinRemotePath(slot.host, occdSlotDir(slot, version), OCCD_PID_FILENAME)
  const raw = await execOCCdRemote(slot, `cat ${quotePosixShell(pidFile)} 2>/dev/null || true`)
  const pid = Number.parseInt(raw.trim(), 10)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

/** The holder's slot must publish readiness for this pid, from the build installed there. */
async function proveHolderServesItsSlot(slot: OCCdSlotOptions, holder: LockHolder): Promise<void> {
  const label = `An occd (pid ${holder.pid}, ${holder.version}) is running in this distro but is not the recorded one`
  const dirName = remoteInstallDirName(OCCD_INSTALL_MODEL, holder.version)
  if (!remoteInstallVersionDirRegex(OCCD_INSTALL_MODEL).test(dirName)) {
    throw new WslOCCdUnrecordedInstanceError(`${label}, and its version is not a slot name.`)
  }
  const target = await readRemoteOCCdManagedStopTarget(slot, holder.version)
  if (target.state !== 'ready' || target.context.instance.pid !== holder.pid) {
    throw new WslOCCdUnrecordedInstanceError(
      `${label}, and it cannot be identified: ${target.state === 'refused' ? target.reason : 'its readiness names another process.'}`
    )
  }
  const identity = await resolveOCCdSlotIdentity(slot, holder.version)
  const readiness = parseOCCdReadinessWaitOutput(
    slot.host,
    await execOCCdRemote(slot, readOCCdReadinessNowCommand(slot.host, identity.remoteDir))
  )
  const verdict = evaluateOCCdActivation(
    readiness.state === 'ready' ? readiness.readiness : null,
    {
      buildHash: identity.buildHash,
      fullVersion: identity.version
    }
  )
  if (verdict.decision === 'reject') {
    throw new WslOCCdUnrecordedInstanceError(`${label}, and ${verdict.reason}`)
  }
}

function adoptedRecord(
  record: OCCdActivationRecord,
  version: string,
  now: Date
): OCCdActivationRecord {
  if (record.active === version) {
    return record
  }
  const { activeAppVersion, previousAppVersion: _previousAppVersion, ...rest } = record
  return {
    ...rest,
    active: version,
    previous: record.active ?? record.previous,
    ...(record.active && activeAppVersion ? { previousAppVersion: activeAppVersion } : {}),
    activatedAt: now.toISOString(),
    // Prelaunch snapshot belongs to another activation; rollback must not restore it.
    snapshot: null
  }
}

/** Adopt lock owners missing from record/pid file only with proof; otherwise refuse rather than launch into an occupied instance lock. */
export async function adoptUnrecordedWslOCCd(
  slot: OCCdSlotOptions,
  record: OCCdActivationRecord,
  now: () => Date = () => new Date(),
  /** This connect's snapshot of the lock; the fenced re-check below always reads the host. */
  preReadLock?: WslOCCdInstanceLockRead
): Promise<WslOCCdAdoption> {
  const holder = await readLiveLockHolder(slot, preReadLock)
  if (!holder) {
    return { outcome: 'none' }
  }
  if (
    record.active === holder.version &&
    (await readSlotPid(slot, holder.version)) === holder.pid
  ) {
    return { outcome: 'none' }
  }
  await proveHolderServesItsSlot(slot, holder)
  return withOCCdActivationLock(
    slot,
    async () => {
      const current = await readOCCdActivationRecord(slot)
      if (!sameOCCdActivationRecord(current, record)) {
        throw new WslOCCdUnrecordedInstanceError(
          'The activation record changed while an unrecorded occd was being adopted. Retry.'
        )
      }
      if (await readOCCdActivationTransaction(slot)) {
        throw new WslOCCdUnrecordedInstanceError(
          'An interrupted activation is pending, so an unrecorded occd cannot be adopted yet.'
        )
      }
      const again = await readLiveLockHolder(slot)
      if (again?.pid !== holder.pid || again.version !== holder.version) {
        throw new WslOCCdUnrecordedInstanceError(
          'The unrecorded occd changed while it was being adopted. Retry.'
        )
      }
      const pidFile = joinRemotePath(
        slot.host,
        occdSlotDir(slot, holder.version),
        OCCD_PID_FILENAME
      )
      await execOCCdRemote(
        slot,
        `(umask 077 && printf '%s\\n' ${String(holder.pid)} > ${quotePosixShell(pidFile)})`
      )
      const next = adoptedRecord(current, holder.version, now())
      if (next !== current) {
        await writeOCCdActivationRecord(slot, next)
      }
      return {
        outcome: 'adopted' as const,
        version: holder.version,
        pid: holder.pid,
        record: next
      }
    },
    () => {
      throw new WslOCCdUnrecordedInstanceError(
        'Another OCC is changing this distro’s server, so an unrecorded occd cannot be adopted now.'
      )
    }
  )
}
