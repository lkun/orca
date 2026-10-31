import { writeOCCdActivationRecord } from '../activation/occd-activation-record-store'
import type { OCCdActivationRecoveryResult } from '../activation/occd-activation-recovery'
import type { OCCdDecommissionRecoveryPlan } from './occd-decommission-transaction'
import { settleOCCdDecommissionStop } from './occd-decommission-stop'
import {
  occdLivenessProbeCommand,
  occdLivenessProvenExited,
  parseOCCdLiveness
} from '../install/occd-remote-launch'
import { execOCCdRemote } from '../install/occd-remote-runtime-control'
import {
  ensureOCCdSlotServing,
  occdSlotDir,
  resolveOCCdSlotIdentity,
  type OCCdSlotOptions
} from '../../ssh/occd-recovery-slot'

/** Only proven exit clears an interrupted decommission journal. */
export async function reconcileOCCdDecommission(
  options: OCCdSlotOptions,
  plan: OCCdDecommissionRecoveryPlan
): Promise<OCCdActivationRecoveryResult> {
  if (plan.action === 'keep-serving') {
    const identity = await resolveOCCdSlotIdentity(options, plan.version)
    return {
      outcome: 'recovered',
      resolution: 'restored-incumbent',
      activeVersion: plan.version,
      readiness: await ensureOCCdSlotServing(options, identity)
    }
  }
  if (plan.action === 'resume-stop') {
    const settlement = await settleOCCdDecommissionStop(options, plan.request)
    if (settlement.state === 'unsettled') {
      return {
        outcome: 'refused',
        verdict: settlement.verdict,
        code: 'occd_recovery_decommission_unsettled',
        reason: settlement.reason
      }
    }
    if (settlement.state === 'withdrawn') {
      return reconcileOCCdDecommission(options, {
        action: 'keep-serving',
        version: plan.request.version
      })
    }
    return reconcileOCCdDecommission(options, {
      action: 'confirm-decommissioned',
      version: plan.request.version,
      record: plan.record
    })
  }
  // Live or unanswered slots retain the fence; only proven exit permits commit.
  const liveness = parseOCCdLiveness(
    await execOCCdRemote(
      options,
      occdLivenessProbeCommand(options.host, occdSlotDir(options, plan.version))
    )
  )
  if (!occdLivenessProvenExited(liveness)) {
    return {
      outcome: 'refused',
      verdict: liveness === 'LIVE' ? 'live' : 'unverifiable',
      code: 'occd_recovery_decommissioned_slot_not_exited',
      reason: `occd ${plan.version} is recorded as stopped but is ${liveness.toLowerCase()}.`
    }
  }
  if (plan.record) {
    await writeOCCdActivationRecord(options, plan.record)
  }
  return { outcome: 'recovered', resolution: 'committed', activeVersion: null, readiness: null }
}
