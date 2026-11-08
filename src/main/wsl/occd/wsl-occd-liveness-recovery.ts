/** C4 recovery uses bounded relaunch backoff, then census before publishing terminal verdicts. Recovery is never a user action, so it needs a confirmed-running distro and never boots one (E9). */
import type { OCCdTerminalCensus } from '../../../shared/occd-terminal-census'
import { wslHostStatusDetailText } from '../../../shared/wsl-host-failure-copy'
import type { WslRunningDistrosRead } from '../discovery/wsl-background-distro-gate'
import { wslDistroHolderKey } from '../discovery/wsl-distro-holder-record'
import type { WslOCCdConnection } from './wsl-occd-connection-types'
import type { WslOCCdConnectOptions } from './wsl-occd-connection'
import type { WslOCCdConnectionStatus } from './wsl-occd-connection-status'
import type { WslLivenessVerdict } from './wsl-occd-liveness-verdict'
import type { WslOCCdReconnectBackoff } from './wsl-occd-reconnect-backoff'

export type WslOCCdRecoveryReason = 'occd-exited' | 'distro-restarted' | 'distro-stopped'

export type WslOCCdRecoveryContext = {
  distro: string
  backoff: WslOCCdReconnectBackoff
  now: () => number
  /** False once the distro stopped being supervised or a newer recovery took over. */
  current: () => boolean
  wait: (delayMs: number) => Promise<void>
  publish: (status: WslOCCdConnectionStatus) => void
  ensure: (options: WslOCCdConnectOptions) => Promise<WslOCCdConnection>
  collectCensus: (connection: WslOCCdConnection) => Promise<OCCdTerminalCensus>
  /** Records the new occd's identity and holds a fresh watch. */
  arm: (connection: WslOCCdConnection) => Promise<void>
  readRunning: () => Promise<WslRunningDistrosRead>
}

/** Ends ready, failed, or with the verdict the background gate found instead (returned). */
export async function recoverWslOCCd(
  context: WslOCCdRecoveryContext,
  reason: WslOCCdRecoveryReason
): Promise<WslLivenessVerdict | null> {
  const terminals = reason === 'occd-exited' ? 'unverifiable' : 'exited'
  for (;;) {
    const decision = context.backoff.next(context.now())
    if (decision.kind === 'give-up') {
      const gaveUp = wslHostStatusDetailText('restartGaveUp', {
        distro: context.distro,
        count: decision.attempts
      })
      context.publish({
        state: 'failed',
        reason: gaveUp.text,
        reasonCode: gaveUp.code,
        reasonParams: gaveUp.params,
        terminals
      })
      return null
    }
    const reconnecting = {
      state: 'reconnecting',
      reason,
      attempt: decision.attempt,
      terminals
    } as const
    context.publish({ ...reconnecting, retryInMs: decision.delayMs })
    await context.wait(decision.delayMs)
    if (!context.current()) {
      return null
    }
    const gate = backgroundRecoveryGate(await context.readRunning(), context.distro)
    if (gate || !context.current()) {
      return gate
    }
    try {
      const connection = await context.ensure({
        status: {
          pending: { ...reconnecting, retryInMs: null },
          ready: { ...reconnecting, reason: 'census', retryInMs: null }
        }
      })
      if (!context.current()) {
        return null
      }
      // Recount before marking terminals; the daemon may have preserved all sessions across occd loss.
      const census = await context.collectCensus(connection)
      await context.arm(connection)
      if (context.current()) {
        context.publish({ state: 'ready', census })
      }
      return null
    } catch (error) {
      console.warn(
        `[wsl] reconnect to ${context.distro} failed:`,
        error instanceof Error ? error.message : error
      )
      if (!context.current()) {
        return null
      }
    }
  }
}

/** null lets a background recovery go ahead: the distro is confirmed running. */
export function backgroundRecoveryGate(
  running: WslRunningDistrosRead,
  distro: string
): WslLivenessVerdict | null {
  if (running.status !== 'confirmed') {
    return { kind: 'unverifiable', reason: 'running-list-unavailable' }
  }
  const key = wslDistroHolderKey(distro)
  return running.distros.some((candidate) => wslDistroHolderKey(candidate) === key)
    ? null
    : { kind: 'distro-stopped', corroborated: false }
}
