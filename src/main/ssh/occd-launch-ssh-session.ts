/** macOS pins Local Network attribution at spawn: SSH-launched terminals can lose LAN access after sshd-session exits (#25934; Apple TN3179). Record the nearest session plus start time and matching slot PID; preserve earlier attribution while a live terminal daemon survives occd restarts. */
import { quotePosixShell } from '../../shared/shell/launch/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import { OCCD_PID_FILENAME } from '../managed-server/install/occd-remote-host-support'

export const OCCD_LAUNCH_SSH_SESSION_FILENAME = '.occd-launch-ssh-session'

const LOCAL_NETWORK_PRIVACY_MAJOR = 15
// Bounds the ancestor walk; real chains are a few processes deep.
const MAX_ANCESTOR_DEPTH = 32

export function recordsOCCdLaunchSshSession(host: RemoteHostPlatform): boolean {
  return host.os === 'darwin'
}

/** Choose the nearest sshd ancestor, which exits with this session; a listener farther up would remain alive. */
export function occdSshSessionAncestorShellFunction(): string {
  return (
    'occd_ssh_session() { occd_sp=$1; occd_si=0; ' +
    `while [ "$occd_si" -lt ${MAX_ANCESTOR_DEPTH} ]; do ` +
    'case "$occd_sp" in "" | *[!0-9]* | 0 | 1) return 1;; esac; ' +
    'occd_sc=$(ps -o comm= -p "$occd_sp" 2>/dev/null) || return 1; ' +
    'case "${occd_sc##*/}" in sshd*) ' +
    'occd_ss=$(ps -o lstart= -p "$occd_sp" 2>/dev/null) || return 1; ' +
    // Why unquoted: normalizes lstart's padding so a later read compares equal.
    'echo "$occd_sp" $occd_ss; return 0;; esac; ' +
    'occd_sp=$(ps -o ppid= -p "$occd_sp" 2>/dev/null | tr -d " "); ' +
    'occd_si=$((occd_si + 1)); done; return 1; };'
  )
}

/** Capture before detach without failing launch. */
export function captureOCCdLaunchSshSessionCommand(): string {
  return (
    `${occdSshSessionAncestorShellFunction()} ` +
    'occd_session=$(occd_ssh_session "$$" 2>/dev/null) || occd_session=;'
  )
}

function recordPath(host: RemoteHostPlatform, userDataDir: string): string {
  return quotePosixShell(joinRemotePath(host, userDataDir, OCCD_LAUNCH_SSH_SESSION_FILENAME))
}

/** Return 0 for this root's live daemon, 1 for absence, 2 for unreadable argv; PID files alone may name recycled processes. */
function liveDaemonShellFunction(host: RemoteHostPlatform, userDataDir: string): string {
  const daemonDir = quotePosixShell(joinRemotePath(host, userDataDir, 'daemon'))
  return (
    `occd_daemon_live() { occd_ddir=${daemonDir}; for occd_df in "$occd_ddir"/daemon-v*.pid; do ` +
    '[ -f "$occd_df" ] || continue; ' +
    'occd_dp=$(sed -n \'s/.*"pid":\\([0-9][0-9]*\\).*/\\1/p\' "$occd_df" | head -n 1); ' +
    '[ -n "$occd_dp" ] || continue; ' +
    'kill -0 "$occd_dp" 2>/dev/null || continue; ' +
    'occd_da=$(ps -o args= -p "$occd_dp" 2>/dev/null); [ -n "$occd_da" ] || return 2; ' +
    'case "$occd_da" in *daemon-entry*"$occd_ddir"* | *"$occd_ddir"*daemon-entry*) return 0;; esac; ' +
    'done; return 1; };'
  )
}

/** After recording $!, preserve the live daemon's earlier session; otherwise record this launch's session. */
export function writeOCCdLaunchSshSessionCommand(
  host: RemoteHostPlatform,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  return (
    // First-deploy detach may run before occd creates its data root.
    `{ occd_bg=$!; ( umask 077; mkdir -p ${quotePosixShell(userDataDir)} ); ` +
    `${liveDaemonShellFunction(host, userDataDir)} ` +
    'occd_daemon_live; occd_dl=$?; ' +
    'if [ "$occd_dl" = 0 ]; then ' +
    `occd_prev=$(cat ${file}); rm -f ${file}; set -- $occd_prev; ` +
    `[ "$#" -lt 3 ] || { shift; ( umask 077; echo "$occd_bg" "$@" > ${file} ); }; ` +
    // Unreadable daemon identity leaves attribution unknown, never assigned to this launch.
    `elif [ "$occd_dl" = 2 ]; then rm -f ${file}; ` +
    `else rm -f ${file}; [ -z "$occd_session" ] || ` +
    `( umask 077; echo "$occd_bg" $occd_session > ${file} ); fi; :; } 2>/dev/null`
  )
}

export function occdLaunchSshSessionProbeCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string,
  userDataDir: string
): string {
  const file = recordPath(host, userDataDir)
  const pidFile = quotePosixShell(joinRemotePath(host, remoteInstallDir, OCCD_PID_FILENAME))
  return [
    'occd_mac=$(sw_vers -productVersion 2>/dev/null) || { echo NOT_APPLICABLE; exit 0; };',
    'occd_major=${occd_mac%%.*};',
    'case "$occd_major" in "" | *[!0-9]*) echo UNVERIFIABLE; exit 0;; esac;',
    `[ "$occd_major" -ge ${LOCAL_NETWORK_PRIVACY_MAJOR} ] || { echo NOT_APPLICABLE; exit 0; };`,
    `occd_rec=$(cat ${file} 2>/dev/null) || { echo NOT_RECORDED; exit 0; };`,
    `occd_pid=$(cat ${pidFile} 2>/dev/null);`,
    'set -- $occd_rec;',
    'case "$1:$2" in *[!0-9:]* | :* | *:) echo NOT_RECORDED; exit 0;; esac;',
    '[ "$1" = "$occd_pid" ] || { echo NOT_RECORDED; exit 0; };',
    'occd_sshd=$2; shift 2; occd_want=$*;',
    // A ps that can't list this shell can't prove another process absent.
    'ps -o pid= -p "$$" >/dev/null 2>&1 || { echo UNVERIFIABLE; exit 0; };',
    'occd_now=$(ps -o lstart= -p "$occd_sshd" 2>/dev/null); occd_now=$(echo $occd_now);',
    // A reused PID with another start time is a different process: the session is gone.
    'if [ -z "$occd_now" ] || [ "$occd_now" != "$occd_want" ]; then echo EXITED; else echo LIVE; fi'
  ].join(' ')
}

/** `not-recorded` covers older launches and clients: the condition is unknown, never assumed. */
export type OCCdLaunchSshSession =
  | 'live'
  | 'exited'
  | 'unverifiable'
  | 'not-recorded'
  | 'not-applicable'

export function parseOCCdLaunchSshSession(output: string): OCCdLaunchSshSession {
  switch (output.trim().split('\n').pop()?.trim() ?? '') {
    case 'LIVE':
      return 'live'
    case 'EXITED':
      return 'exited'
    case 'NOT_RECORDED':
      return 'not-recorded'
    case 'NOT_APPLICABLE':
      return 'not-applicable'
    default:
      return 'unverifiable'
  }
}
