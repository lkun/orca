/** Capture before OCC inserts its managed-script shell. */
export const HOOK_PARENT_CAPTURE = 'OCC_HOOK_AGENT_PID="${PPID:-}"; export OCC_HOOK_AGENT_PID; '

// Uncached, as no builtin tells a reused PID from its old process: Linux reads /proc, macOS runs only ps.
export function buildHookProcessCapture(): string[] {
  return [
    'occ_agent_process=',
    // Field 20 after the command name is the start time in clock ticks since boot.
    'occ_agent_start_ticks() { occ_agent_start=${20-}; }',
    '[ -z "${OCC_PANE_KEY:-}" ] || case "${OCC_HOOK_AGENT_PID:-}" in ""|*[!0-9]*) ;; *)',
    '  if [ -r "/proc/$OCC_HOOK_AGENT_PID/stat" ]; then',
    '    occ_agent_stat= occ_agent_line= occ_agent_boot= occ_agent_start=',
    // Read to EOF: a command name may contain a newline, and the strip below takes the last ") ".
    '    while IFS= read -r occ_agent_line || [ -n "$occ_agent_line" ]; do occ_agent_stat="$occ_agent_stat$occ_agent_line "; occ_agent_line=; done 2>/dev/null < "/proc/$OCC_HOOK_AGENT_PID/stat"',
    '    IFS= read -r occ_agent_boot 2>/dev/null < /proc/sys/kernel/random/boot_id',
    '    occ_agent_start_ticks ${occ_agent_stat##*) }',
    '    case "$occ_agent_start" in ""|*[!0-9]*) ;; *)',
    '      [ -z "$occ_agent_boot" ] || occ_agent_process="{\\"pid\\":$OCC_HOOK_AGENT_PID,\\"platform\\":\\"linux\\",\\"startTime\\":\\"$occ_agent_boot:$occ_agent_start\\"}" ;; esac',
    // Bash sets OSTYPE on macOS; other shells still ask uname.
    '  elif case "${OSTYPE-}" in darwin*) ;; *) [ "$(uname -s 2>/dev/null)" = Darwin ] ;; esac; then',
    // Match the host probe's timezone when comparing local-time lstart strings.
    '    occ_agent_start=$(TZ=UTC0 LC_ALL=C exec /bin/ps -p "$OCC_HOOK_AGENT_PID" -o lstart= 2>/dev/null)',
    '    occ_agent_start=${occ_agent_start#"${occ_agent_start%%[! ]*}"}',
    '    occ_agent_start=${occ_agent_start%"${occ_agent_start##*[! ]}"}',
    '    [ -z "$occ_agent_start" ] || occ_agent_process="{\\"pid\\":$OCC_HOOK_AGENT_PID,\\"platform\\":\\"darwin\\",\\"startTime\\":\\"$occ_agent_start\\"}"',
    '  fi ;;',
    'esac',
    // A tmux pane's own server, socket and pane id; only a lookup hint for the host's attachment check.
    'occ_tmux_pane=',
    'case "${TMUX_PANE:-}" in %[0-9]*) [ -z "${TMUX:-}" ] || occ_tmux_pane="$TMUX_PANE ${TMUX%,*,*}" ;; esac'
  ]
}
