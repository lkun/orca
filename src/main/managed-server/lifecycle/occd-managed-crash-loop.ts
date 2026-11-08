// Stop waking a managed occd that keeps dying; an explicit Connect re-arms automatic starts.
import { OCCdUnexpectedExitSchema } from '../../../shared/occd-unexpected-exit'
import { RemoteRuntimeClientError } from '../../../shared/remote-runtime/remote-runtime-client-error'
import type { OCCdHealth } from '../../occd/occd-health'
import { isOCCdLaunchFailure, occdLaunchFailureRanProcess } from '../../ssh/occd-launch-failure'
import { occdSlotDir, type OCCdSlotOptions } from '../../ssh/occd-recovery-slot'
import { isWindowsRemoteHost, joinRemotePath } from '../../ssh/ssh-remote-platform'
import { execOCCdRemote } from '../install/occd-remote-runtime-control'
import { readOCCdActivationRecord } from '../activation/occd-activation-record-store'
import { OCCD_LOG_FILENAME } from '../install/occd-remote-host-support'
import { withOCCdLogTail } from '../install/occd-remote-log-tail'
import { readBoundedOCCdRemoteRecord } from '../install/occd-remote-record-file'
import { OCCD_LOCK_FILE_NAME } from '../../occd/occd-instance-lock'
import { MAX_OCCD_LOCK_BYTES } from '../../occd/occd-instance-lock-reclaim'
import { ManagedOCCdEventWindow } from './occd-managed-event-window'
import { wakeStoppedManagedOCCd } from './occd-managed-wake'

export const MAX_FAILED_RUNS_PER_WINDOW = 3
export const FAILED_RUN_WINDOW_MS = 10 * 60_000

/** Counts starts that failed and runs the next occd proved ended uncleanly; holds until reconnect. */
export class ManagedOCCdCrashLoopBrake {
  private readonly failures: ManagedOCCdEventWindow
  /** Engaged hosts, with the reason once read from the host. */
  private readonly engagedHosts = new Map<string, string | null>()
  /** A failed start already counted; the next occd's report of it must not count twice. */
  private readonly countedFailedStarts = new Set<string>()
  // Wakes begun before an explicit reconnect must not undo its reset.
  private readonly resets = new Map<string, number>()
  private readonly latchedOnServingRun = new Set<string>()
  private readonly lastFailedStart = new Map<string, string>()
  /** The answering machine's boot when the brake engaged; null when it could not be read. */
  private readonly latchedBoot = new Map<string, MachineBoot | null>()
  private readonly engagedAt = new Map<string, number>()

  constructor(private readonly now: () => number = () => Date.now()) {
    this.failures = new ManagedOCCdEventWindow(FAILED_RUN_WINDOW_MS, now)
  }

  resetEpoch(environmentId: string): number {
    return this.resets.get(environmentId) ?? 0
  }

  /** Older occd builds omit the report, so they are never braked. */
  noteStarted(environmentId: string, epoch: number, health: OCCdHealth | undefined): void {
    if (epoch !== this.resetEpoch(environmentId)) {
      return
    }
    const alreadyCounted = this.countedFailedStarts.delete(environmentId)
    if (
      !alreadyCounted &&
      OCCdUnexpectedExitSchema.safeParse(health?.previousUnexpectedExit).success
    ) {
      this.record(environmentId)
      if (this.engaged(environmentId)) {
        this.latchedOnServingRun.add(environmentId)
      }
    }
  }

  noteFailedStart(environmentId: string, epoch: number, failure: Error): void {
    if (epoch !== this.resetEpoch(environmentId)) {
      return
    }
    if (occdLaunchFailureRanProcess(failure)) {
      this.countedFailedStarts.add(environmentId)
    }
    const reason = failure.message
    this.lastFailedStart.set(environmentId, reason)
    this.latchedOnServingRun.delete(environmentId)
    this.record(environmentId)
  }

  /** A served run's clean exit (its lock gone) may release the brake, even one that served late.
   * Only an answer received after the brake engaged counts; an earlier one may be from a run since gone. */
  noteServing(environmentId: string, answeredAt: number = this.now()): void {
    const engagedAt = this.engagedAt.get(environmentId)
    if (engagedAt !== undefined && answeredAt >= engagedAt) {
      this.latchedOnServingRun.add(environmentId)
    }
  }

  /** True when the latch came from a run that served, whose own exit decides whether it still holds. */
  latchedOnServingRunOf(environmentId: string): boolean {
    return this.latchedOnServingRun.has(environmentId)
  }

  latchedBootOf(environmentId: string): MachineBoot | null | undefined {
    return this.latchedBoot.get(environmentId)
  }

  setLatchedBoot(environmentId: string, boot: MachineBoot | null): void {
    if (this.engaged(environmentId)) {
      this.latchedBoot.set(environmentId, boot)
    }
  }

  lastFailedStartOf(environmentId: string): string | null {
    return this.lastFailedStart.get(environmentId) ?? null
  }

  engaged(environmentId: string): boolean {
    return this.engagedHosts.has(environmentId)
  }

  detail(environmentId: string): string | null {
    return this.engagedHosts.get(environmentId) ?? null
  }

  setDetail(environmentId: string, detail: string): void {
    if (this.engaged(environmentId)) {
      this.engagedHosts.set(environmentId, detail)
    }
  }

  forget(environmentId: string): void {
    this.failures.forget(environmentId)
    this.engagedHosts.delete(environmentId)
    this.countedFailedStarts.delete(environmentId)
    this.latchedOnServingRun.delete(environmentId)
    this.lastFailedStart.delete(environmentId)
    this.latchedBoot.delete(environmentId)
    this.engagedAt.delete(environmentId)
    this.resets.set(environmentId, this.resetEpoch(environmentId) + 1)
  }

  private record(environmentId: string): void {
    this.failures.record(environmentId)
    if (this.failures.recent(environmentId).length >= MAX_FAILED_RUNS_PER_WINDOW) {
      if (!this.engaged(environmentId)) {
        this.engagedAt.set(environmentId, this.now())
      }
      this.engagedHosts.set(environmentId, this.detail(environmentId))
    }
  }
}

/** Seconds come from the host's own clock, so desktop clock skew never enters the comparison. */
type MachineBoot = { bootId: string; machine: string; bootedAt: number; readAt: number }

const brake = new ManagedOCCdCrashLoopBrake()

/** A braked host's refusal; it reports the server, never a failed update or action. */
export class OCCdCrashLoopError extends RemoteRuntimeClientError {
  constructor(detail: string) {
    super('runtime_unavailable', detail)
    this.name = 'OCCdCrashLoopError'
  }
}

export function getManagedOCCdCrashLoopBrake(): ManagedOCCdCrashLoopBrake {
  return brake
}

type ManagedOCCdSlot = OCCdSlotOptions

type BrakedWake =
  | Exclude<Awaited<ReturnType<typeof wakeStoppedManagedOCCd>>, { outcome: 'launch-refused' }>
  | { outcome: 'crash-loop'; detail: string }

const wakes = new Map<string, Promise<unknown>>()

/** Every automatic wake of a managed occd goes through here so the brake sees each start. */
export function wakeManagedOCCdUnlessCrashLooping(
  environmentId: string,
  hostLabel: string,
  slot: ManagedOCCdSlot,
  onStarting?: () => void
): Promise<BrakedWake> {
  // Queued wakes must see the failure an earlier wake just recorded; the epoch is the caller's.
  const epoch = brake.resetEpoch(environmentId)
  const prior = wakes.get(environmentId)
  const wake = (async () => {
    await prior?.catch(() => {})
    return wakeUnlessEngaged(environmentId, epoch, hostLabel, slot, onStarting)
  })()
  wakes.set(environmentId, wake)
  void wake
    .catch(() => {})
    .finally(() => {
      if (wakes.get(environmentId) === wake) {
        wakes.delete(environmentId)
      }
    })
  return wake
}

async function wakeUnlessEngaged(
  environmentId: string,
  epoch: number,
  hostLabel: string,
  slot: ManagedOCCdSlot,
  onStarting?: () => void
): Promise<BrakedWake> {
  if (brake.engaged(environmentId) && (await latchedRunEndedWithoutCrash(environmentId, slot))) {
    brake.forget(environmentId)
    // This wake starts the fresh budget, so it must count.
    epoch = brake.resetEpoch(environmentId)
  }
  try {
    // The brake refuses only a new launch, at the decision itself; live servers are reported as they are.
    const wake = await wakeStoppedManagedOCCd(
      slot,
      onStarting,
      () => !brake.engaged(environmentId)
    )
    if (wake.outcome === 'launch-refused') {
      return {
        outcome: 'crash-loop',
        detail: await crashLoopDetail(environmentId, hostLabel, slot)
      }
    }
    if (wake.outcome === 'started') {
      brake.noteStarted(environmentId, epoch, wake.readiness.health)
    }
    if ((wake.outcome === 'fenced' || wake.outcome === 'recovery-refused') && wake.launchFailure) {
      brake.noteFailedStart(environmentId, epoch, wake.launchFailure)
    }
    await recordLatchedBoot(environmentId, slot)
    return wake
  } catch (error) {
    // A host-policy refusal is not counted: nothing ran, and its own message says what to change.
    if (isOCCdLaunchFailure(error)) {
      brake.noteFailedStart(environmentId, epoch, error)
      await recordLatchedBoot(environmentId, slot)
    }
    throw error
  }
}

/** Taken as the brake engages, so a later boot of the same machine proves the loop's runs ended. */
async function recordLatchedBoot(environmentId: string, slot: ManagedOCCdSlot): Promise<void> {
  if (brake.engaged(environmentId) && brake.latchedBootOf(environmentId) === undefined) {
    brake.setLatchedBoot(environmentId, await readMachineBoot(slot))
  }
}

/** Linux only; null elsewhere or when any part is missing. */
async function readMachineBoot(slot: ManagedOCCdSlot): Promise<MachineBoot | null> {
  if (isWindowsRemoteHost(slot.host)) {
    return null
  }
  try {
    const lines = (await execOCCdRemote(slot, MACHINE_BOOT_COMMAND)).trim().split('\n')
    const [bootId, hostname, machineId, bootedAt, readAt] = lines.map((line) => line.trim())
    const seconds = (value: string | undefined): number | null =>
      value && /^\d+$/.test(value) ? Number(value) : null
    const booted = seconds(bootedAt)
    const read = seconds(readAt)
    return lines.length === 5 && bootId && hostname && machineId && booted !== null && read !== null
      ? { bootId, machine: `${hostname}\n${machineId}`, bootedAt: booted, readAt: read }
      : null
  } catch {
    return null
  }
}

const MACHINE_BOOT_COMMAND =
  '{ cat /proc/sys/kernel/random/boot_id && uname -n && cat /etc/machine-id && ' +
  "awk '/^btime /{print $2}' /proc/stat && date +%s; } 2>/dev/null || :"

/**
 * A served run releases occd.lock on a clean exit. A reboot ends every run, but only a new boot of
 * the machine that answered when the brake engaged proves one: shared homes reach other machines.
 */
async function latchedRunEndedWithoutCrash(
  environmentId: string,
  slot: ManagedOCCdSlot
): Promise<boolean> {
  const latched = brake.latchedBootOf(environmentId)
  if (latched) {
    const current = await readMachineBoot(slot)
    // A clone shares hostname and machine id, so the new boot must also postdate the latch.
    if (
      current &&
      current.machine === latched.machine &&
      current.bootId !== latched.bootId &&
      current.bootedAt > latched.readAt
    ) {
      return true
    }
  }
  if (!brake.latchedOnServingRunOf(environmentId)) {
    return false
  }
  try {
    const lock = await readBoundedOCCdRemoteRecord(
      slot,
      joinRemotePath(slot.host, slot.userDataDir, OCCD_LOCK_FILE_NAME),
      MAX_OCCD_LOCK_BYTES
    )
    return lock.state === 'absent'
  } catch {
    // Unreadable proves nothing; stay braked.
    return false
  }
}

async function crashLoopDetail(
  environmentId: string,
  hostLabel: string,
  slot: ManagedOCCdSlot
): Promise<string> {
  const known = brake.detail(environmentId)
  if (known) {
    return known
  }
  const lastFailure = brake.lastFailedStartOf(environmentId)
  const withLastFailure = (message: string): string =>
    lastFailure ? `${message}\nLast failed start: ${lastFailure}` : message
  let detail = withLastFailure(
    crashLoopMessage(hostLabel, `the active server's ${OCCD_LOG_FILENAME}`)
  )
  try {
    const active = (await readOCCdActivationRecord(slot)).active
    if (active) {
      const slotDir = occdSlotDir(slot, active)
      const message = crashLoopMessage(
        hostLabel,
        joinRemotePath(slot.host, slotDir, OCCD_LOG_FILENAME)
      )
      // The log is appended across launches, so its tail still holds the last run's error.
      detail = await withOCCdLogTail(slot, slotDir, withLastFailure(message))
    }
  } catch (error) {
    console.warn(`[ssh] Could not read the managed OCC server's log on ${hostLabel}:`, error)
  }
  console.warn(`[ssh] ${detail.split('\n')[0]}`)
  brake.setDetail(environmentId, detail)
  return detail
}

function crashLoopMessage(hostLabel: string, logPath: string): string {
  return (
    `OCC stopped restarting its server on ${hostLabel}: it failed or exited unexpectedly ` +
    `${MAX_FAILED_RUNS_PER_WINDOW} times in ${FAILED_RUN_WINDOW_MS / 60_000} minutes. ` +
    `Check ${logPath} on the host, fix the cause, then disconnect and reconnect the host to try again.`
  )
}
