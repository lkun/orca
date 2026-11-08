// Win32-OpenSSH kills session jobs; require native breakaway without WMI/PowerShell, then record PID plus creation time.
import {
  OCCD_WINDOWS_BREAKAWAY_CONTRACT,
  parseWindowsBreakawayLaunchReport,
  WINDOWS_BREAKAWAY_ENV_FLAG,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
  WINDOWS_BREAKAWAY_STDERR_FLAG,
  WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
  WINDOWS_BREAKAWAY_STDOUT_FLAG
} from '../../../shared/windows-breakaway-launch'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  occdWindowsNodeCommandLine,
  occdWindowsSlotOpCommand,
  readOCCdWindowsEncodedAnswer
} from './occd-remote-windows-node'
import {
  OCCD_WINDOWS_ENTRY_MARKER,
  OCCD_WINDOWS_RUNTIME_MARKER
} from '../host-state/occd-windows-host-script'
import {
  OCCD_LOG_FILENAME,
  OCCD_READINESS_FILENAME,
  OCCD_WINDOWS_PROCESS_FILENAME
} from './occd-remote-host-support'
import { occdManagedLaunchEnv, type OCCdLaunchSpec } from './occd-remote-launch'
import { OCCD_WINDOWS_LAUNCH_REFUSED_CODE } from '../../occd/occd-host-unavailable'

export class OCCdWindowsLaunchRefusedError extends Error {
  readonly code = OCCD_WINDOWS_LAUNCH_REFUSED_CODE
  constructor(reason: string) {
    super(
      `The Windows host refused to start occd outside the SSH session (${reason}). occd needs ` +
        'a job that allows breakaway and a slot with the process-tree launcher; it never falls ' +
        'back to WMI.'
    )
    this.name = 'OCCdWindowsLaunchRefusedError'
  }
}

/** The launcher reported that it could not start occd. */
export class OCCdWindowsLaunchFailedError extends Error {
  constructor(detail: string) {
    super(`occd's Windows launcher did not start the candidate: ${detail}.`)
    this.name = 'OCCdWindowsLaunchFailedError'
  }
}

/** Resolve pinned slot runtime and remove stale instance-stop intent before launch. */
export function windowsOCCdLaunchRuntimeCommand(
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return occdWindowsSlotOpCommand(host, slotDir, 'slot-runtime', [slotDir, 'clear-stop-request'])
}

export function readWindowsOCCdSlotRuntime(output: string): string {
  const runtime = readOCCdWindowsEncodedAnswer(output, OCCD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this occd slot needs.')
  }
  return runtime
}

/** Older host scripts omit entry, implying the legacy single-file launcher. */
export function readWindowsOCCdSlotEntry(
  output: string,
  host: RemoteHostPlatform,
  slotDir: string
): string {
  return (
    readOCCdWindowsEncodedAnswer(output, OCCD_WINDOWS_ENTRY_MARKER) ??
    joinRemotePath(host, slotDir, 'occd.js')
  )
}

export function windowsOCCdLaunchCommand(
  host: RemoteHostPlatform,
  spec: OCCdLaunchSpec,
  slotRuntime: string,
  slotEntry = joinRemotePath(host, spec.remoteInstallDir, 'occd.js')
): string {
  const dir = spec.remoteInstallDir
  return occdWindowsNodeCommandLine(slotRuntime, [
    slotEntry,
    WINDOWS_BREAKAWAY_LAUNCH_FLAG,
    // CREATE_ALWAYS removes stale readiness before the launcher returns.
    WINDOWS_BREAKAWAY_STDOUT_FLAG,
    joinRemotePath(host, dir, OCCD_READINESS_FILENAME),
    WINDOWS_BREAKAWAY_STDERR_FLAG,
    joinRemotePath(host, dir, OCCD_LOG_FILENAME),
    // Preserve previous stderr for crash diagnosis across restart.
    WINDOWS_BREAKAWAY_STDERR_KEEP_PREVIOUS_FLAG,
    WINDOWS_BREAKAWAY_PROCESS_FILE_FLAG,
    joinRemotePath(host, dir, OCCD_WINDOWS_PROCESS_FILENAME),
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `OCC_VERSION=${spec.fullVersion}`,
    WINDOWS_BREAKAWAY_ENV_FLAG,
    `OCC_USER_DATA=${spec.userDataDir}`,
    ...occdManagedLaunchEnv(spec).flatMap(([name, value]) => [
      WINDOWS_BREAKAWAY_ENV_FLAG,
      `${name}=${value}`
    ]),
    OCCD_WINDOWS_BREAKAWAY_CONTRACT.argsFlag,
    '--json',
    '--bind',
    spec.bindHost,
    '--port',
    String(spec.port)
  ])
}

export function hasWindowsOCCdLaunchReport(output: string): boolean {
  return parseWindowsBreakawayLaunchReport(OCCD_WINDOWS_BREAKAWAY_CONTRACT, output) !== null
}

/** Return launched PID or surface native-breakaway refusal/failure. */
export function readWindowsOCCdLaunchReport(output: string): number {
  const report = parseWindowsBreakawayLaunchReport(OCCD_WINDOWS_BREAKAWAY_CONTRACT, output)
  if (report?.method === 'breakaway') {
    return report.pid
  }
  if (report?.method === 'unavailable') {
    throw new OCCdWindowsLaunchRefusedError(
      report.step ? `${report.reason} at ${report.step}` : report.reason
    )
  }
  if (report?.method === 'failed') {
    throw new OCCdWindowsLaunchFailedError(
      `${report.reason}${report.step ? ` at ${report.step}` : ''} (code ${String(report.code ?? 0)})`
    )
  }
  throw new Error("occd's Windows launcher did not start the candidate: no launch report.")
}
