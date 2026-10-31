// Journal instance-bound stop under the activation fence; refuse live/unknown terminal census and deactivate only after proven exit.
import { randomUUID } from 'node:crypto'
import type { OCCdActivationRecord } from '../activation/occd-activation-record'
import {
  readOCCdActivationRecord,
  writeOCCdActivationRecord
} from '../activation/occd-activation-record-store'
import { sameOCCdActivationRecord } from '../activation/occd-activation-transaction'
import { writeOCCdActivationTransaction } from '../activation/occd-activation-transaction-store'
import { withOCCdActivationLock } from '../activation/occd-activation-lock'
import { occdActivationFenceRefusal } from '../activation/occd-activation-fence-hold'
import {
  committedOCCdDecommissionRecord,
  createOCCdDecommissionTransaction,
  withOCCdDecommissionProcessExited,
  withOCCdDecommissionStopDispatched
} from '../lifecycle/occd-decommission-transaction'
import { readRemoteOCCdManagedStopTarget } from '../lifecycle/occd-managed-remote-stop'
import { settleOCCdDecommissionStop } from '../lifecycle/occd-decommission-stop'
import type { OCCdSlotOptions } from '../../ssh/occd-recovery-slot'
import type { OCCdDecommissionResult } from '../../../shared/occd-decommission'
import type { OCCdTerminalCensus } from '../../../shared/occd-terminal-census'

type OCCdDecommissionOptions = OCCdSlotOptions & {
  /** Refuse if the host record changed since caller review. */
  record: OCCdActivationRecord
  /** Fresh census must prove no live or uncounted terminals. */
  census: OCCdTerminalCensus
  now?: () => Date
}

type Refusal = Extract<OCCdDecommissionResult, { outcome: 'refused' }>

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

function censusRefusal(census: OCCdTerminalCensus): Refusal | null {
  if (census.liveSessions === null) {
    return refuse(
      'unverifiable',
      'occd_decommission_census_unavailable',
      'The terminal daemon did not answer a session count, so decommissioning could end ' +
        'running work. Retry when the host answers.'
    )
  }
  if (census.liveSessions > 0) {
    return refuse(
      'live',
      'occd_decommission_terminals_running',
      `${census.liveSessions} terminal${census.liveSessions === 1 ? ' is' : 's are'} still ` +
        'running on this host. Close them before decommissioning the server.'
    )
  }
  return null
}

export async function decommissionRemoteOCCd(
  options: OCCdDecommissionOptions
): Promise<OCCdDecommissionResult> {
  const now = options.now ?? ((): Date => new Date())
  return withOCCdActivationLock(
    options,
    async (lock) => {
      const record = await readOCCdActivationRecord(options)
      if (!sameOCCdActivationRecord(record, options.record)) {
        return refuse(
          'unverifiable',
          'occd_decommission_record_changed',
          'The host activation record changed since it was reviewed. Refresh and try again.'
        )
      }
      const activeVersion = record.active
      if (!activeVersion) {
        return refuse(
          'unverifiable',
          'occd_decommission_nothing_active',
          'No occd version is active on this host, so there is nothing to decommission.'
        )
      }
      const census = censusRefusal(options.census)
      if (census) {
        return census
      }
      const target = await readRemoteOCCdManagedStopTarget(options, activeVersion)
      if (target.state === 'refused') {
        return refuse(target.verdict, target.code, target.reason)
      }

      let transaction = createOCCdDecommissionTransaction({
        transactionId: randomUUID(),
        recordBefore: { ...record, active: activeVersion },
        now: now()
      })
      await writeOCCdActivationTransaction(options, transaction)
      lock.retainOnError()
      const request = {
        schemaVersion: 1 as const,
        transactionId: transaction.transactionId,
        ...target.context,
        // Idle daemon retirement is best-effort; busy daemons retain their terminals.
        retireIdleDaemon: true as const
      }
      // Journal exact stop intent before dispatch so recovery can settle the same request.
      transaction = withOCCdDecommissionStopDispatched(transaction, request, now())
      await writeOCCdActivationTransaction(options, transaction)

      const settlement = await settleOCCdDecommissionStop(options, request)
      if (settlement.state === 'withdrawn') {
        return refuse(settlement.verdict, 'occd_decommission_stop_withdrawn', settlement.reason)
      }
      if (settlement.state === 'unsettled') {
        lock.retain()
        return refuse(settlement.verdict, 'occd_decommission_stop_unsettled', settlement.reason)
      }
      transaction = withOCCdDecommissionProcessExited(transaction, now())
      await writeOCCdActivationTransaction(options, transaction)
      await writeOCCdActivationRecord(options, committedOCCdDecommissionRecord(transaction))
      return {
        outcome: 'decommissioned',
        version: activeVersion,
        retirement: settlement.retirement
      }
    },
    async () => {
      const refusal = await occdActivationFenceRefusal(options, 'stop')
      return refuse('unverifiable', refusal.code, refusal.reason)
    }
  )
}
