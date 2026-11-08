// RPC readiness cannot prove terminal health; cross the daemon socket boundary for its own self-test.
import { hashOCCdLauncher } from '../../shared/occd-build-identity'
import {
  confirmPtyProcessCeiling,
  type PtyProcessCeilingState
} from '../../shared/terminal/pty/native-process/pty-process-ceiling-state'
import process from 'node:process'
import { checkDaemonHealthWithCoverage, type DaemonHealth } from '../daemon/health/daemon-health'
import { ptySpawnHealthPlatformCoverage } from '../daemon/health/daemon-health-identity'
import {
  daemonOwnsFreshPersistentPtys,
  getDaemonEndpointFacts,
  readDaemonPidRecord
} from '../daemon/providers/lifecycle/daemon-provider-state'
import type { OCCdProfileStateAuthoritySelection } from './occd-profile-state-telemetry'
import { OCCD_STOP_REQUESTS_CAPABILITY } from '../../shared/occd-stop-request'
import type { OCCdIdleStopRecord } from '../../shared/occd-idle-exit'
import type { OCCdUnexpectedExit } from '../../shared/occd-unexpected-exit'
import { occdPreviousUnexpectedExit } from './occd-unexpected-exit'

/** Distinguish real PTY spawn coverage from handshake-only platform probes. */
type PtySelfTestCoverage = 'pty-spawn' | 'handshake'

type PtySelfTest = {
  ok: boolean
  coverage: PtySelfTestCoverage
  verdict: DaemonHealth | 'no-daemon'
  durationMs: number
}

export type TerminalDaemonHealth = {
  /** Live requires a reply; silence cannot establish absence. */
  state: 'live' | 'degraded' | 'absent'
  /** New PTYs survive restart only while daemon-owned. */
  ownsFreshSessions: boolean
  pid: number | null
  /** Live daemon build may predate occd after an update. */
  buildVersion: string | null
  entryPath: string | null
  protocolVersion: number | null
  /** Null means unscoped; combined-unit systemctl restart may reap that daemon. */
  cgroupUnit: string | null
  /** Older daemons omit process ceilings; newer reports include on/off and a reason. */
  processCeiling?: PtyProcessCeilingState | null
  selfTest: PtySelfTest
}

export type OCCdHealth = {
  /** Launcher hash understood by older clients; split launchers embed the server digest. */
  buildHash: string
  buildVersion: string
  nodeVersion: string
  nodeAbi: string
  platform: NodeJS.Platform
  arch: string
  pid: number
  terminalDaemon: TerminalDaemonHealth
  profileStateAuthority?: OCCdProfileStateAuthoritySelection
  /** Absent on old builds that still require SIGTERM stopping. */
  stopRequests?: typeof OCCD_STOP_REQUESTS_CAPABILITY
  /** Managed launches only; older/user-started builds omit prior idle-stop outcomes. */
  previousIdleStop?: OCCdIdleStopRecord | null
  /** Older builds omit it; null means the previous run stopped cleanly or its boot is unknown. */
  previousUnexpectedExit?: OCCdUnexpectedExit | null
}

/** Hash launcher contents: inherited version strings cannot prove that rollback replaced a build. */
export function computeOCCdBuildHash(entryPath = process.argv[1]): string {
  if (!entryPath) {
    return 'unknown'
  }
  try {
    return hashOCCdLauncher(entryPath)
  } catch {
    return 'unknown'
  }
}

/** Probe through the socket: responsive RPC alone cannot prove the daemon can create terminals. */
async function runTerminalDaemonSelfTest(
  now: () => number = () => Date.now()
): Promise<PtySelfTest> {
  const startedAt = now()
  const facts = getDaemonEndpointFacts()
  if (!facts) {
    return {
      ok: false,
      coverage: ptySpawnHealthPlatformCoverage(),
      verdict: 'no-daemon',
      durationMs: now() - startedAt
    }
  }
  // Older daemons lack explicit coverage; fall back by platform.
  const { verdict, coverage } = await checkDaemonHealthWithCoverage(
    facts.socketPath,
    facts.tokenPath
  )
  return { ok: verdict === 'healthy', coverage, verdict, durationMs: now() - startedAt }
}

export async function collectTerminalDaemonHealth(): Promise<TerminalDaemonHealth> {
  const facts = getDaemonEndpointFacts()
  const selfTest = await runTerminalDaemonSelfTest()
  if (!facts) {
    return {
      state: 'absent',
      ownsFreshSessions: false,
      pid: null,
      buildVersion: null,
      entryPath: null,
      protocolVersion: null,
      cgroupUnit: null,
      selfTest
    }
  }
  const record = readDaemonPidRecord()
  const ownsFreshSessions = daemonOwnsFreshPersistentPtys()
  return {
    // Failed spawn probes can coexist with live sessions; degradation must not imply their exit.
    state:
      selfTest.ok && ownsFreshSessions
        ? 'live'
        : selfTest.verdict === 'no-daemon'
          ? 'absent'
          : 'degraded',
    ownsFreshSessions,
    pid: record?.pid ?? null,
    buildVersion: record?.appVersion ?? null,
    entryPath: record?.entryPath ?? null,
    protocolVersion: facts.protocolVersion,
    cgroupUnit: record?.cgroupUnit ?? null,
    processCeiling: confirmPtyProcessCeiling(record?.processCeiling ?? null),
    selfTest
  }
}

export async function collectOCCdHealth(
  buildVersion: string,
  profileStateAuthority?: OCCdProfileStateAuthoritySelection,
  previousIdleStop?: OCCdIdleStopRecord | null
): Promise<OCCdHealth> {
  return {
    buildHash: computeOCCdBuildHash(),
    buildVersion,
    nodeVersion: process.versions.node,
    nodeAbi: process.versions.modules ?? 'unknown',
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    terminalDaemon: await collectTerminalDaemonHealth(),
    ...(profileStateAuthority ? { profileStateAuthority } : {}),
    stopRequests: OCCD_STOP_REQUESTS_CAPABILITY,
    ...(previousIdleStop !== undefined ? { previousIdleStop } : {}),
    previousUnexpectedExit: occdPreviousUnexpectedExit()
  }
}
