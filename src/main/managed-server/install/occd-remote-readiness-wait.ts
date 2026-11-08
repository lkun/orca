// Wait on-host in one bounded exec; repeated SSH polling spawned process bursts and triggered Windows EDR.
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import {
  OCCD_PID_FILENAME,
  OCCD_PID_MACHINE_FILENAME,
  OCCD_READINESS_FILENAME,
  OCCD_READINESS_MAX_BYTES,
  OCCD_LAUNCH_MACHINE_COMMAND,
  POSIX_NO_SUCH_PROCESS_CASE
} from './occd-remote-host-support'
import {
  parseOCCdReadinessOutput,
  readOCCdReadinessCommand,
  type OCCdReadinessParse
} from './occd-remote-launch'
import {
  occdWindowsSlotOpCommand,
  readOCCdWindowsEncodedAnswer
} from './occd-remote-windows-node'
import { OCCD_WINDOWS_READINESS_MARKER } from '../host-state/occd-windows-host-script'

// Stay below the 30-second exec timeout so waits can answer before channel expiry.
export const OCCD_READINESS_WAIT_MAX_SECONDS = 20

const OCCD_LAUNCH_EXITED_MARKER = 'OCCD_LAUNCH_EXITED'

function posixReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const file = quotePosixShell(joinRemotePath(host, remoteInstallDir, OCCD_READINESS_FILENAME))
  const read = `head -c ${OCCD_READINESS_MAX_BYTES + 1} ${file} 2>/dev/null`
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, OCCD_PID_FILENAME))
  const pidMachine = quotePosixShell(
    joinRemotePath(host, remoteInstallDir, OCCD_PID_MACHINE_FILENAME)
  )
  return [
    // Fail early only on proven exit from the launching machine; shared homes and unverified PIDs must keep waiting.
    `occd_launch_here() { occd_recorded=$(cat ${pidMachine} 2>/dev/null) && [ -n "$occd_recorded" ] && [ "$occd_recorded" = "$(${OCCD_LAUNCH_MACHINE_COMMAND} 2>/dev/null)" ]; };`,
    `occd_launch_exited() { occd_launch_here || return 1; pid=$(cat ${pidFile} 2>/dev/null); case "$pid" in "" | *[!0-9]*) return 1;; esac;`,
    `probe_error=$(LC_ALL=C kill -0 "$pid" 2>&1) || { case "$probe_error" in ${POSIX_NO_SUCH_PROCESS_CASE}) return 0;; esac; return 1; };`,
    'case "$(ps -o stat= -p "$pid" 2>/dev/null)" in Z*) return 0;; esac; return 1; };',
    // Probe fractional sleep once; POSIX hosts may support only integer seconds.
    'if sleep 0.25 2>/dev/null; then occd_readiness_wait_step=0.25;',
    'else occd_readiness_wait_step=1; fi;',
    // Bound elapsed time, not iterations: slow filesystem reads otherwise overrun the client exec deadline.
    `occd_readiness_wait_end=$(($(date +%s) + ${waitSeconds}));`,
    'while [ "$(date +%s)" -lt "$occd_readiness_wait_end" ]; do',
    `[ "$(${read} | wc -l)" -gt 0 ] && break;`,
    `[ "$(${read} | wc -c)" -gt ${OCCD_READINESS_MAX_BYTES} ] && break;`,
    `occd_launch_exited && { echo ${OCCD_LAUNCH_EXITED_MARKER}; break; };`,
    'sleep "$occd_readiness_wait_step"; done;',
    `${read} || true`
  ].join(' ')
}

export function occdReadinessWaitCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  waitSeconds: number
): string {
  const seconds = Math.max(0, Math.min(OCCD_READINESS_WAIT_MAX_SECONDS, Math.ceil(waitSeconds)))
  if (!isWindowsRemoteHost(host)) {
    return posixReadinessWaitCommand(host, remoteInstallDir, seconds)
  }
  return occdWindowsSlotOpCommand(host, remoteInstallDir, 'readiness-wait', [
    joinRemotePath(host, remoteInstallDir, OCCD_READINESS_FILENAME),
    String(OCCD_READINESS_MAX_BYTES),
    String(seconds)
  ])
}

export function parseOCCdReadinessWaitOutput(
  host: RemoteHostPlatform,
  output: string
): OCCdReadinessParse {
  return parseOCCdReadinessOutput(
    isWindowsRemoteHost(host)
      ? (readOCCdWindowsEncodedAnswer(output, OCCD_WINDOWS_READINESS_MARKER) ?? '')
      : withoutLaunchExitedMarker(output)
  )
}

export function occdLaunchExitedDuringWait(host: RemoteHostPlatform, output: string): boolean {
  return !isWindowsRemoteHost(host) && output.startsWith(`${OCCD_LAUNCH_EXITED_MARKER}\n`)
}

function withoutLaunchExitedMarker(output: string): string {
  return output.startsWith(`${OCCD_LAUNCH_EXITED_MARKER}\n`)
    ? output.slice(OCCD_LAUNCH_EXITED_MARKER.length + 1)
    : output
}

export function readOCCdReadinessNowCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  // Windows host wait with zero delay substitutes for the unavailable head command.
  return isWindowsRemoteHost(host)
    ? occdReadinessWaitCommand(host, remoteInstallDir, 0)
    : readOCCdReadinessCommand(host, remoteInstallDir)
}
