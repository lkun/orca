import { OCCD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/occd-profile-preflight'
import {
  occdLaunchCommand,
  parseOCCdReadinessOutput,
  type OCCdLaunchSpec,
  type OCCdReadinessParse
} from './occd-remote-launch'
import {
  hasWindowsOCCdLaunchReport,
  readWindowsOCCdLaunchReport,
  readWindowsOCCdSlotRuntime,
  readWindowsOCCdSlotEntry,
  windowsOCCdLaunchCommand,
  windowsOCCdLaunchRuntimeCommand
} from './occd-remote-launch-windows'
import {
  OCCD_READINESS_WAIT_MAX_SECONDS,
  occdLaunchExitedDuringWait,
  occdReadinessWaitCommand,
  parseOCCdReadinessWaitOutput
} from './occd-remote-readiness-wait'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import { errorMessage } from '../../../shared/error-message'
import {
  execCommand,
  isSshCommandExitError,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import {
  currentOCCdFence,
  isOCCdFenceLost,
  OCCdFenceLostError,
  posixOCCdFenceGuard
} from '../activation/occd-activation-fence-scope'
import { occdWindowsHomeOpCommand } from './occd-remote-windows-node'
import { OCCD_WINDOWS_FENCE_ARG } from '../host-state/occd-windows-host-fence-ops'
import { isWindowsRemoteHost, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

// Pause even after early host answers to avoid a tight retry loop.
const READINESS_RETRY_PAUSE_MS = 1_000

export type OCCdRemoteExecTarget = {
  conn: OCCdHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  /** Locates the runtime store for host-record scripts; required on Windows, unused elsewhere. */
  remoteHome?: string
}

/** A held activation fence must still name this run before any host step. */
export async function execOCCdRemote(
  target: OCCdRemoteExecTarget,
  command: string,
  signal = target.signal
): Promise<string> {
  const fence = currentOCCdFence()
  const run = (line: string): Promise<string> =>
    execCommand(target.conn, line, {
      wrapCommand: target.host.commandDialect !== 'powershell',
      signal
    })
  try {
    if (!fence) {
      return await run(command)
    }
    if (!isWindowsRemoteHost(target.host)) {
      return await run(`${posixOCCdFenceGuard(fence)} ${command}`)
    }
    // Host ops check ownership internally; other commands need a preceding check.
    if (!command.includes(OCCD_WINDOWS_FENCE_ARG) && target.remoteHome) {
      await run(occdWindowsHomeOpCommand(target.host, target.remoteHome, 'fence-check', []))
    }
    return await run(command)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    throw isOCCdFenceLost(error) ? new OCCdFenceLostError() : error
  }
}

/** Only confirmed failures use fallback; unconfirmed failures and lost fences propagate. */
export function execOCCdRemoteOr(
  target: OCCdRemoteExecTarget,
  command: string,
  fallback = ''
): Promise<string> {
  return execOCCdRemote(target, command).catch((error: unknown) => {
    if (isUnconfirmedSshCommandTermination(error) || error instanceof OCCdFenceLostError) {
      throw error
    }
    return fallback
  })
}

/** Recovery paths must finish even when the request that started them was cancelled. */
export function withoutAbortSignal<T extends { signal?: AbortSignal }>(
  options: T
): Omit<T, 'signal'> {
  const { signal: _signal, ...rest } = options
  return rest
}

export async function launchOCCdAndAwaitReadiness(
  target: OCCdRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: OCCdLaunchSpec
): Promise<OCCdReadinessParse> {
  if (isWindowsRemoteHost(target.host)) {
    const slotAnswer = await execOCCdRemote(
      target,
      windowsOCCdLaunchRuntimeCommand(target.host, spec.remoteInstallDir)
    )
    const slotRuntime = readWindowsOCCdSlotRuntime(slotAnswer)
    const slotEntry = readWindowsOCCdSlotEntry(slotAnswer, target.host, spec.remoteInstallDir)
    readWindowsOCCdLaunchReport(
      await windowsLaunchReportOutput(
        target,
        windowsOCCdLaunchCommand(target.host, spec, slotRuntime, slotEntry)
      )
    )
  } else {
    await execOCCdRemote(
      target,
      occdLaunchCommand(
        target.host,
        spec,
        target.conn.occdLaunchDetach ?? 'nohup',
        (await target.conn.occdLaunchEnv?.({ fullVersion: spec.fullVersion })) ?? []
      )
    )
  }
  const deadline = Date.now() + (target.readinessTimeoutMs ?? OCCD_STARTUP_READINESS_TIMEOUT_MS)
  const sleep = target.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let last = parseOCCdReadinessOutput('')
  let lastWaitError: unknown
  // Always read once, even if client scheduling outlasted the deadline.
  for (let first = true; first || Date.now() < deadline; first = false) {
    target.signal?.throwIfAborted()
    const waitSeconds = Math.min(
      OCCD_READINESS_WAIT_MAX_SECONDS,
      Math.ceil((deadline - Date.now()) / 1000)
    )
    let output: string
    try {
      output = await execOCCdRemote(
        target,
        occdReadinessWaitCommand(target.host, spec.remoteInstallDir, waitSeconds)
      )
    } catch (error) {
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        isUnconfirmedSshCommandTermination(error) ||
        error instanceof OCCdFenceLostError
      ) {
        throw error
      }
      // Failed reads do not prove launch failure; stopping here could kill a healthy candidate.
      lastWaitError = error
      console.warn(`[occd] readiness wait failed; retrying: ${errorMessage(error)}`)
      await sleep(READINESS_RETRY_PAUSE_MS)
      continue
    }
    target.signal?.throwIfAborted()
    lastWaitError = undefined
    last = parseOCCdReadinessWaitOutput(target.host, output)
    // An exited launch answers as the deadline would, so callers attach the same log tail.
    if (last.state !== 'pending' || occdLaunchExitedDuringWait(target.host, output)) {
      return last
    }
    await sleep(READINESS_RETRY_PAUSE_MS)
  }
  if (lastWaitError !== undefined) {
    throw lastWaitError
  }
  return last
}

/** The launcher writes its report before exiting nonzero, so a failed launch still names its cause. */
async function windowsLaunchReportOutput(
  target: OCCdRemoteExecTarget,
  command: string
): Promise<string> {
  try {
    return await execOCCdRemote(target, command)
  } catch (error) {
    // Without a report the command error carries the better diagnostic.
    if (isSshCommandExitError(error) && hasWindowsOCCdLaunchReport(error.stdout)) {
      return error.stdout
    }
    throw error
  }
}
