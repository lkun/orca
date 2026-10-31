// Windows operations use the host script; only POSIX command builders use this guard.
import { isWindowsRemoteHost, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

export class OCCdRemoteLaunchUnsupportedError extends Error {
  readonly code = 'occd_remote_launch_unsupported_host'
  constructor(hostLabel: string) {
    super(
      `This occd command does not run on a ${hostLabel} host. The install transaction is ` +
        'host-agnostic, but this step is a POSIX command with a separate Windows path.'
    )
    this.name = 'OCCdRemoteLaunchUnsupportedError'
  }
}

export function assertPosixOCCdHost(host: RemoteHostPlatform): void {
  if (isWindowsRemoteHost(host)) {
    throw new OCCdRemoteLaunchUnsupportedError('Windows')
  }
}

/** Candidate stdout containing readiness; bounded below even if other output follows. */
export const OCCD_READINESS_FILENAME = '.occd-readiness'
export const OCCD_LOG_FILENAME = 'occd.log'
// Candidate stdout is untrusted in size; never read runaway output whole.
export const OCCD_READINESS_MAX_BYTES = 256 * 1024

export const OCCD_PID_FILENAME = '.occd-pid'
/** Pair the PID with boot ID and node name; shared home paths cannot identify a machine. */
export const OCCD_PID_MACHINE_FILENAME = `${OCCD_PID_FILENAME}-machine`
/** Emit nothing without a boot ID; launch and later wait compare this identity. */
export const OCCD_LAUNCH_MACHINE_COMMAND = 'cat /proc/sys/kernel/random/boot_id&&uname -n'

/** Windows pairs PID with creation time because PID reuse alone cannot identify the process. */
export const OCCD_WINDOWS_PROCESS_FILENAME = '.occd-process.json'

/** kill -0 includes zombies; ps excludes them, while missing evidence conservatively retains the process. */
export function posixProcessAliveShellFunction(
  options: { refuseUnverifiable?: boolean } = {}
): string {
  // Destructive lifecycle steps need explicit absence; permission failures cannot prove exit.
  const probe = options.refuseUnverifiable
    ? 'probe_error=$(LC_ALL=C kill -0 "$1" 2>&1) || { ' +
      'case "$probe_error" in *"No such process"*) return 1;; ' +
      '*) echo UNKNOWN; exit 0;; esac; }; '
    : 'kill -0 "$1" 2>/dev/null || return 1; '
  return (
    `occd_alive() { ${probe}` +
    'occd_stat=$(ps -o stat= -p "$1" 2>/dev/null) && [ -n "$occd_stat" ] || ' +
    // Field 3 of /proc/<pid>/stat follows the last ")": comm itself may hold spaces or parens.
    'occd_stat=$(cat "/proc/$1/stat" 2>/dev/null) && occd_stat=${occd_stat##*") "}; ' +
    'case "$occd_stat" in Z*) return 1;; esac; return 0; };'
  )
}

/** Prints a PID's argv; slim Linux images ship no ps, so fall back to /proc (#34149). */
export function posixProcessArgsShellFunction(): string {
  return (
    'occd_args() { occd_argv=$(ps -o args= -p "$1" 2>/dev/null) && [ -n "$occd_argv" ] || ' +
    '{ occd_argv=$(tr "\\000" " " 2>/dev/null < "/proc/$1/cmdline") || return 1; ' +
    // Kernel threads and zombies have no argv; their stat line still names them.
    '[ -n "$occd_argv" ] || occd_argv=$(cat "/proc/$1/stat" 2>/dev/null) || return 1; }; ' +
    'printf "%s\\n" "$occd_argv"; };'
  )
}
