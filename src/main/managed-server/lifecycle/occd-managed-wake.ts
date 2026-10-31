// OCCd exit does not prove terminal exit: the terminal daemon can outlive the server.
import { OCCD_FENCE_OWNER_FILENAME } from '../activation/occd-activation-fence-scope'
import type { ServeReadiness } from '../../server/serve-readiness'
import { readOCCdActivationRecord } from '../activation/occd-activation-record-store'
import { randomUUID } from 'node:crypto'
import {
  occdActivationFenceExists,
  releaseOCCdActivationFence,
  withOCCdActivationLock
} from '../activation/occd-activation-lock'
import { occdLivenessProvenExited } from '../install/occd-remote-launch'
import { readBoundedOCCdRemoteRecord } from '../install/occd-remote-record-file'
import { occdActivationFenceLockDir } from '../activation/occd-activation-transaction'
import { joinRemotePath } from '../../ssh/ssh-remote-platform'

import { readOCCdActivationTransaction } from '../activation/occd-activation-transaction-store'
import {
  OCCD_RECOVERY_UNVERIFIABLE_CODE,
  recoverInterruptedOCCdActivation
} from '../activation/occd-activation-recovery'
import {
  ensureOCCdSlotServing,
  occdSlotDir,
  resolveOCCdSlotIdentity,
  slotLiveness,
  type OCCdSlotOptions
} from '../../ssh/occd-recovery-slot'

type OCCdManagedWake =
  | { outcome: 'serving' | 'not-activated' | 'unverifiable' }
  | { outcome: 'fenced' }
  | { outcome: 'started'; readiness: ServeReadiness }
  | { outcome: 'recovery-refused'; reason: string }

/** Start only proven-stopped active slots; leave live or unverifiable processes alone. */
export function wakeStoppedManagedOCCd(
  options: OCCdSlotOptions,
  onStarting: () => void = () => {}
): Promise<OCCdManagedWake> {
  return serializedWake(options, (host) => wakeAfterPrior(options, host, onStarting))
}

/**
 * WSL's same-version connect: one fence both confirms `expectActive` is still the active slot
 * and starts it if proven stopped. 'replan' means another version is active now; 'fenced' that
 * the fence was busy. Either way the caller takes the full deploy and wake.
 */
export function wakeExpectedOCCdUnderOneFence(
  options: OCCdSlotOptions,
  expectActive: string
): Promise<OCCdManagedWake | { outcome: 'replan' }> {
  return serializedWake(options, async (host) => {
    // An earlier wake's dropped fence is reclaimed only by the full wake, which knows its token.
    if (interruptedWakes.has(host)) {
      return { outcome: 'fenced' }
    }
    // Record ownership before acquisition, as the wake does: a dropped reply leaves a fence only it can reclaim.
    const token = randomUUID()
    interruptedWakes.set(host, token)
    const result = await withOCCdActivationLock(
      options,
      async (): Promise<OCCdManagedWake | { outcome: 'replan' }> => {
        if ((await readOCCdActivationRecord(options)).active !== expectActive) {
          return { outcome: 'replan' }
        }
        const liveness = await slotLiveness(options, occdSlotDir(options, expectActive))
        if (!occdLivenessProvenExited(liveness)) {
          return { outcome: liveness === 'LIVE' ? 'serving' : 'unverifiable' }
        }
        const identity = await resolveOCCdSlotIdentity(options, expectActive)
        return { outcome: 'started', readiness: await ensureOCCdSlotServing(options, identity) }
      },
      (): OCCdManagedWake => ({ outcome: 'fenced' }),
      token
    )
    if (interruptedWakes.get(host) === token) {
      interruptedWakes.delete(host)
    }
    return result
  })
}

function serializedWake<T>(
  options: OCCdSlotOptions,
  run: (host: string) => Promise<T>
): Promise<T> {
  const host = wakeHostKey(options)
  // Serialize per host before remote work so reconnect cannot race an earlier wake's unexplained fence.
  const prior = runningWakes.get(host)
  const wake = (async (): Promise<T> => {
    await prior?.catch(() => {})
    return run(host)
  })()
  runningWakes.set(host, wake)
  void wake
    .catch(() => {})
    .finally(() => {
      if (runningWakes.get(host) === wake) {
        runningWakes.delete(host)
      }
    })
  return wake
}

async function wakeAfterPrior(
  options: OCCdSlotOptions,
  host: string,
  onStarting: () => void
): Promise<OCCdManagedWake> {
  const before = await readOCCdActivationRecord(options)
  if (!before.active) {
    return { outcome: 'not-activated' }
  }
  const liveness = await slotLiveness(options, occdSlotDir(options, before.active))
  if (!occdLivenessProvenExited(liveness)) {
    await forgetSettledInterruptedWake(options, host, liveness === 'LIVE')
    return { outcome: liveness === 'LIVE' ? 'serving' : 'unverifiable' }
  }
  if (!(await occdActivationFenceExists(options))) {
    interruptedWakes.delete(host)
  } else if (!(await releaseOwnInterruptedWakeFence(options, host))) {
    const recovered = await recoverAbandonedFence(options, onStarting)
    if (recovered) {
      return recovered
    }
  }
  // Record ownership before acquisition: dropped replies can leave fences only this token can reclaim.
  const token = randomUUID()
  interruptedWakes.set(host, token)
  const result = await withOCCdActivationLock(
    options,
    async (): Promise<OCCdManagedWake> => {
      // Other clients may change the active slot; reread under the fence.
      const active = (await readOCCdActivationRecord(options)).active
      if (!active) {
        return { outcome: 'not-activated' }
      }
      const identity = await resolveOCCdSlotIdentity(options, active)
      onStarting()
      return { outcome: 'started', readiness: await ensureOCCdSlotServing(options, identity) }
    },
    (): OCCdManagedWake => ({ outcome: 'fenced' }),
    token
  )
  if (interruptedWakes.get(host) === token) {
    interruptedWakes.delete(host)
  }
  return result
}

/** Recover abandoned journals under stale, previous-boot or proven-exited fences; busy runs retain ownership. */
async function recoverAbandonedFence(
  options: OCCdSlotOptions,
  onStarting: () => void
): Promise<OCCdManagedWake | null> {
  const recovery = await recoverInterruptedOCCdActivation(options)
  switch (recovery.outcome) {
    case 'none':
      return null
    case 'pending':
      return { outcome: 'fenced' }
    case 'refused':
      // Retry unverifiable recovery at the next fence check, as with a busy owner.
      return recovery.code === OCCD_RECOVERY_UNVERIFIABLE_CODE
        ? { outcome: 'fenced' }
        : { outcome: 'recovery-refused', reason: recovery.reason }
    case 'recovered':
      if (!recovery.readiness) {
        return { outcome: 'not-activated' }
      }
      onStarting()
      return { outcome: 'started', readiness: recovery.readiness }
  }
}

const runningWakes = new Map<string, Promise<unknown>>()

const interruptedWakes = new Map<string, string>()

function wakeOwnerPath(options: OCCdSlotOptions): string {
  return joinRemotePath(
    options.host,
    occdActivationFenceLockDir(options.host, options.remoteHome),
    OCCD_FENCE_OWNER_FILENAME
  )
}

function wakeHostKey(options: OCCdSlotOptions): string {
  return `${options.conn.getTarget().id}\0${options.remoteHome}`
}

/**
 * A serving slot skips the fence branch that clears an interrupted wake's token, which would
 * keep the one-fence wake off until restart. Forget it once its fence is gone or another owner's;
 * an unanswered probe proves neither, so the token stays. A fence still ours whose dropped launch
 * did start the slot (proven LIVE, no journal) is released, or deploys would wait for it to age out.
 */
async function forgetSettledInterruptedWake(
  options: OCCdSlotOptions,
  host: string,
  slotLive: boolean
): Promise<void> {
  const token = interruptedWakes.get(host)
  if (!token) {
    return
  }
  try {
    const owner = (await occdActivationFenceExists(options))
      ? await readBoundedOCCdRemoteRecord(options, wakeOwnerPath(options), 64)
      : null
    const ours = owner?.state === 'present' && owner.raw.trim() === token
    if (ours && slotLive && !(await readOCCdActivationTransaction(options))) {
      // The release command re-proves the owner token on the host before removing anything.
      await releaseOCCdActivationFence(options, token)
    } else if (ours || owner?.state === 'absent') {
      return
    }
    if (interruptedWakes.get(host) === token) {
      interruptedWakes.delete(host)
    }
  } catch {
    // Unverifiable: keep the token for the next wake.
  }
}

/** Reclaim only this client's journal-free interrupted fence after proving slot exit. */
async function releaseOwnInterruptedWakeFence(
  options: OCCdSlotOptions,
  host: string
): Promise<boolean> {
  const token = interruptedWakes.get(host)
  if (!token || (await readOCCdActivationTransaction(options))) {
    return false
  }
  // A new owner may not have written its token yet; absence cannot prove this fence ours.
  const owner = await readBoundedOCCdRemoteRecord(options, wakeOwnerPath(options), 64)
  if (owner.state !== 'present' || owner.raw.trim() !== token) {
    interruptedWakes.delete(host)
    return false
  }
  await releaseOCCdActivationFence(options, token)
  interruptedWakes.delete(host)
  return true
}
