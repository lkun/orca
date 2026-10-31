/** Capture before OCC inserts its managed-script shell. */
export const CLAUDE_HOOK_PARENT_CAPTURE =
  'OCC_HOOK_AGENT_PID="${PPID:-}"; export OCC_HOOK_AGENT_PID; '

export function buildHookProcessCapture(): string[] {
  return [
    'occ_agent_process=',
    '[ -z "${OCC_PANE_KEY:-}" ] || case "${OCC_HOOK_AGENT_PID:-}" in ""|*[!0-9]*) ;; *)',
    '  if [ -r "/proc/$OCC_HOOK_AGENT_PID/stat" ]; then',
    '    occ_agent_stat=$(cat "/proc/$OCC_HOOK_AGENT_PID/stat" 2>/dev/null) || occ_agent_stat=',
    '    occ_agent_boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null) || occ_agent_boot=',
    '    occ_agent_fields=${occ_agent_stat##*) }',
    '    occ_agent_start=$(printf "%s" "$occ_agent_fields" | awk \'{print $20}\')',
    '    case "$occ_agent_start" in ""|*[!0-9]*) ;; *)',
    '      [ -z "$occ_agent_boot" ] || occ_agent_process=$(printf \'{"pid":%s,"platform":"linux","startTime":"%s:%s"}\' "$OCC_HOOK_AGENT_PID" "$occ_agent_boot" "$occ_agent_start") ;; esac',
    '  elif [ "$(uname -s 2>/dev/null)" = Darwin ]; then',
    // Match the host probe's timezone when comparing local-time lstart strings.
    '    occ_agent_start=$(TZ=UTC0 LC_ALL=C /bin/ps -p "$OCC_HOOK_AGENT_PID" -o lstart= 2>/dev/null | sed \'s/^ *//;s/ *$//\')',
    '    [ -z "$occ_agent_start" ] || occ_agent_process=$(printf \'{"pid":%s,"platform":"darwin","startTime":"%s"}\' "$OCC_HOOK_AGENT_PID" "$occ_agent_start")',
    '  fi ;;',
    'esac'
  ]
}
