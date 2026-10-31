import {
  evaluateOCCdActivation,
  type OCCdActivationVerdict
} from '../managed-server/activation/occd-activation-gate'
import { occdActivationTransactionRoot } from '../managed-server/activation/occd-activation-transaction'
import type { OCCdReadinessParse } from '../managed-server/install/occd-remote-launch'
import {
  launchOCCdAndAwaitReadiness,
  type OCCdRemoteExecTarget
} from '../managed-server/install/occd-remote-runtime-control'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'

type CandidateLaunchTarget = Parameters<typeof launchOCCdAndAwaitReadiness>[0] &
  OCCdRemoteExecTarget & {
    remoteHome: string
    nodePath: string
    userDataDir: string
    bindHost: string
    port: number
  }

/** Rethrow unconfirmed SSH cleanup: it provides no candidate evidence and must never mean rejection. */
export async function launchAndJudgeOCCdSlot(
  options: CandidateLaunchTarget,
  slot: { remoteInstallDir: string; fullVersion: string; buildHash: string }
): Promise<{ verdict: OCCdActivationVerdict; launchError: unknown }> {
  let parsed: OCCdReadinessParse | null = null
  let launchError: unknown
  try {
    parsed = await launchOCCdAndAwaitReadiness(options, {
      remoteInstallDir: slot.remoteInstallDir,
      nodePath: options.nodePath,
      fullVersion: slot.fullVersion,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      activationRoot: occdActivationTransactionRoot(options.host, options.remoteHome)
    })
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    launchError = error
  }
  const verdict = evaluateOCCdActivation(parsed?.state === 'ready' ? parsed.readiness : null, {
    buildHash: slot.buildHash,
    fullVersion: slot.fullVersion
  })
  return { verdict, launchError }
}
