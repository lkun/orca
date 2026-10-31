// Rollback restores a pre-activation snapshot: older builds may not understand newer state.
// Stop, rescue, restore, then launch; the rescue and fenced journal allow recovery of interrupted steps.
import { logOCCdActivationOutcome } from '../activation/occd-activation-outcome-log'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import type { OCCdActivationRecord } from '../activation/occd-activation-record'
import type { OCCdTerminalCensus } from '../../../shared/occd-terminal-census'
import type { OCCdActivationVerdict } from '../activation/occd-activation-gate'
import type { OCCdDaemonProtocolFacts } from '../../ssh/occd-daemon-protocol-crossing'
import { readOCCdActivationRecord } from '../activation/occd-activation-record-store'
import { sameOCCdActivationRecord } from '../activation/occd-activation-transaction'
import type { RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  resolveOCCdActivationReadinessTimeout,
  withOCCdActivationLock
} from '../activation/occd-activation-lock'
import { occdActivationFenceRefusal } from '../activation/occd-activation-fence-hold'
import { OCCD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/occd-profile-preflight'
import { rollbackOCCdLocked } from '../lifecycle/occd-rollback-transition'

export type OCCdRollbackOptions = {
  conn: OCCdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  record: OCCdActivationRecord
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  census: OCCdTerminalCensus
  /** Close terminal admission, then recount under the host lock; any failure is unverifiable. */
  recountCensus: () => Promise<OCCdTerminalCensus>
  /** Reopen admission if rollback leaves the incumbent serving. */
  releaseIncumbentAdmission: () => Promise<void>
  /** Expected hash from the client's copy of the rollback target. */
  targetBuildHash: string
  /** Protocol facts from the same target bytes. */
  targetDaemonProtocol: OCCdDaemonProtocolFacts
  readinessTimeoutMs?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type OCCdRollbackResult =
  | { outcome: 'rolled-back'; target: string; discarded: string[]; verdict: OCCdActivationVerdict }
  | { outcome: 'refused'; code: string; reason: string }
  | { outcome: 'failed'; code: string; reason: string }

export async function rollbackOCCd(input: OCCdRollbackOptions): Promise<OCCdRollbackResult> {
  const options = {
    ...input,
    readinessTimeoutMs: resolveOCCdActivationReadinessTimeout(
      input.readinessTimeoutMs,
      OCCD_STARTUP_READINESS_TIMEOUT_MS
    )
  }
  return logOCCdActivationOutcome(
    `rollback to ${options.record.previous ?? 'none'}`,
    () =>
      withOCCdActivationLock(
        options,
        async (lock) => {
          if (
            !sameOCCdActivationRecord(await readOCCdActivationRecord(options), options.record)
          ) {
            return {
              outcome: 'refused',
              code: 'occd_rollback_record_changed',
              reason:
                'The host activation record changed while this rollback was waiting. Refresh the ' +
                'host state and review the new rollback target before trying again.'
            }
          }
          return rollbackOCCdLocked(options, lock)
        },
        async () => {
          const { code, reason } = await occdActivationFenceRefusal(options, 'rollback')
          return { outcome: 'refused', code, reason }
        }
      ),
    ['rolled-back']
  )
}
