import {
  evaluateOCCdActivation,
  type OCCdActivationExpectation
} from '../managed-server/activation/occd-activation-gate'
import {
  occdLivenessProbeCommand,
  parseOCCdLiveness,
  type OCCdLaunchSpec,
  type OCCdReadinessParse
} from '../managed-server/install/occd-remote-launch'
import {
  execOCCdRemote,
  launchOCCdAndAwaitReadiness,
  type OCCdRemoteExecTarget
} from '../managed-server/install/occd-remote-runtime-control'
import {
  parseOCCdReadinessWaitOutput,
  readOCCdReadinessNowCommand
} from '../managed-server/install/occd-remote-readiness-wait'
import type { ServeReadiness } from '../server/serve-readiness'
import { withOCCdLogTail } from '../managed-server/install/occd-remote-log-tail'
import type { RemoteHostPlatform } from './ssh-remote-platform'

type OCCdReadinessFailureVerdict = 'exited' | 'unverifiable' | 'rejected'

export class OCCdActiveReadinessError extends Error {
  constructor(
    readonly verdict: OCCdReadinessFailureVerdict,
    message: string
  ) {
    super(message)
    this.name = 'OCCdActiveReadinessError'
  }
}

function gatedReadiness(
  parsed: OCCdReadinessParse,
  expectation: OCCdActivationExpectation,
  label: string
): ServeReadiness {
  const readiness = parsed.state === 'ready' ? parsed.readiness : null
  const verdict = evaluateOCCdActivation(readiness, expectation)
  if (verdict.decision === 'reject') {
    throw new OCCdActiveReadinessError(
      'rejected',
      `${label} failed its readiness check: ${verdict.reason}`
    )
  }
  if (!readiness) {
    throw new OCCdActiveReadinessError(
      'rejected',
      `${label} passed activation without a readiness payload.`
    )
  }
  const coverage = occdDaemonCoverageRefusal(readiness)
  if (coverage) {
    throw new OCCdActiveReadinessError('rejected', `${label} ${coverage}`)
  }
  return readiness
}

/** Require PTY self-test coverage, or handshake on platforms that cannot spawn-probe. Older slots without coverage metadata retain the identity-only gate. */
function occdDaemonCoverageRefusal(readiness: ServeReadiness): string | null {
  const health = readiness.health
  const coverage = health?.terminalDaemon?.selfTest?.coverage
  if (!health || coverage === undefined || coverage === 'pty-spawn') {
    return null
  }
  if (coverage === 'handshake' && health.platform === 'win32') {
    return null
  }
  return (
    `reported terminal-daemon coverage '${String(coverage)}', which does not prove a PTY can ` +
    `be created on ${health.platform}.`
  )
}

export async function probeActiveOCCdReadiness(
  target: OCCdRemoteExecTarget & { remoteInstallDir: string },
  expectation: OCCdActivationExpectation
): Promise<ServeReadiness> {
  assertActiveOCCdLive(
    await execOCCdRemote(target, occdLivenessProbeCommand(target.host, target.remoteInstallDir)),
    expectation
  )
  return activeOCCdReadinessFromOutput(
    target.host,
    await execOCCdRemote(
      target,
      readOCCdReadinessNowCommand(target.host, target.remoteInstallDir)
    ),
    expectation
  )
}

/** Throws unless the liveness probe's answer proves the active slot's process is running. */
export function assertActiveOCCdLive(
  livenessOutput: string,
  expectation: OCCdActivationExpectation
): void {
  const liveness = parseOCCdLiveness(livenessOutput)
  if (liveness === 'DEAD') {
    throw new OCCdActiveReadinessError(
      'exited',
      `occd ${expectation.fullVersion} is recorded active but its process has exited.`
    )
  }
  if (liveness === 'NEVER_LAUNCHED') {
    throw new OCCdActiveReadinessError(
      'exited',
      `occd ${expectation.fullVersion} is recorded active but was never started from its install directory.`
    )
  }
  if (liveness !== 'LIVE') {
    throw new OCCdActiveReadinessError(
      'unverifiable',
      `occd ${expectation.fullVersion} process state is unverifiable.`
    )
  }
}

export function activeOCCdReadinessFromOutput(
  host: RemoteHostPlatform,
  readinessOutput: string,
  expectation: OCCdActivationExpectation
): ServeReadiness {
  return gatedReadiness(
    parseOCCdReadinessWaitOutput(host, readinessOutput),
    expectation,
    'The active occd'
  )
}

/** Accept recovery/rollback launches only when they prove the expected build. */
export async function launchOCCdSlotAndAwaitReadiness(
  target: OCCdRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: OCCdLaunchSpec,
  expectation: OCCdActivationExpectation
): Promise<ServeReadiness> {
  const parsed = await launchOCCdAndAwaitReadiness(target, spec)
  try {
    return gatedReadiness(parsed, expectation, `occd ${spec.fullVersion}`)
  } catch (error) {
    if (!(error instanceof OCCdActiveReadinessError)) {
      throw error
    }
    const message = await withOCCdLogTail(target, spec.remoteInstallDir, error.message)
    throw new OCCdActiveReadinessError(error.verdict, message)
  }
}
