/** Retry live fences later, clear abandoned bare fences, and require recovery for interrupted journaled state. */
import {
  occdActivationFenceExists,
  withStaleOCCdActivationRecoveryLock,
  type OCCdActivationLockOptions
} from './occd-activation-lock'
import { readOCCdActivationTransaction } from './occd-activation-transaction-store'
import { occdActivationFenceLockDir } from './occd-activation-transaction'
import { isRelayInstallLockStale } from '../install/remote-install-lock'
import { findExitedOwnLockToken } from '../../ssh/occd-exited-own-lock'
import { occdRemoteBaseDir } from '../install/occd-remote-windows-node'

export const OCCD_ACTIVATION_FENCE_BUSY_CODE = 'occd_activation_fence_busy'
const OCCD_ACTIVATION_RECOVERY_REQUIRED_CODE = 'occd_activation_recovery_required'

type OCCdActivationFenceRefusal = {
  code: string
  reason: string
  /** Bare stale fence cleared; the caller may retry immediately. */
  cleared?: true
}

export async function occdActivationFenceRefusal(
  options: OCCdActivationLockOptions,
  attempt: string
): Promise<OCCdActivationFenceRefusal> {
  const lockDir = occdActivationFenceLockDir(options.host, options.remoteHome)
  const journal = (await readOCCdActivationTransaction(options).catch(() => null)) !== null
  const baseDir = occdRemoteBaseDir(options.host, options.remoteHome)
  const stale =
    (await findExitedOwnLockToken(options, lockDir, { baseDir, guardsStateMutation: true })) !==
      null || (await isRelayInstallLockStale(options.conn, lockDir, options.host))
  if (stale && !journal && (await clearAbandonedFence(options))) {
    return {
      code: OCCD_ACTIVATION_FENCE_BUSY_CODE,
      reason: `An abandoned fence held this host and was cleared; the ${attempt} is retried.`,
      cleared: true
    }
  }
  const stuck = stale || (journal && !(await occdActivationFenceExists(options).catch(() => true)))
  return stuck
    ? {
        code: OCCD_ACTIVATION_RECOVERY_REQUIRED_CODE,
        reason: `An interrupted update or stop holds this host, so the ${attempt} did not start. Recover it first.`
      }
    : {
        code: OCCD_ACTIVATION_FENCE_BUSY_CODE,
        reason: `Another run is changing this host’s OCC server, so the ${attempt} did not start. It is retried on a later connect.`
      }
}

/** Drop a stale fence only after rechecking under takeover that no journal appeared. */
async function clearAbandonedFence(options: OCCdActivationLockOptions): Promise<boolean> {
  try {
    return await withStaleOCCdActivationRecoveryLock(options, async (lock) => {
      if (await readOCCdActivationTransaction(options)) {
        lock.retain()
        return false
      }
      return true
    })
  } catch {
    // Failed takeover leaves the fence intact for normal refusal classification.
    return false
  }
}
