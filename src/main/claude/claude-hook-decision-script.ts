import { CLAUDE_PRE_TOOL_USE_DECISION } from '../agent-hooks/agent-tool-plugin-hooks'

/**
 * Lets Claude Code's PreToolUse hook print OCC's answer (plugins' `agent.tool.before`) instead of
 * a fixed `{}`. Every other event still prints `{}` before it posts, as permission hooks need. The
 * answer is printed only when it is a PreToolUse decision; a timeout, an error or no answer prints
 * `{}`, so the tool call proceeds as if OCC were not there.
 */
export function buildPosixClaudeDecisionPreludeLines(): string[] {
  return [
    'occ_hook_printed=',
    'occ_hook_answer=',
    'occ_hook_decides=',
    // An early exit (a skip path) still prints the `{}` Claude Code needs.
    'occ_hook_finish() {',
    '  [ -z "$occ_hook_printed" ] || return 0',
    '  if [ -n "$occ_hook_answer" ]; then printf \'%s\\n\' "$occ_hook_answer"; else printf \'{}\\n\'; fi',
    '}',
    'trap occ_hook_finish EXIT'
  ]
}

export function buildPosixClaudeDecisionModeLines(): string[] {
  return [
    'case "$payload" in',
    `  *'"hook_event_name":"PreToolUse"'*|*'"hook_event_name": "PreToolUse"'*) occ_hook_decides=${CLAUDE_PRE_TOOL_USE_DECISION}; max_time=8 ;;`,
    "  *) printf '{}\\n'; occ_hook_printed=1 ;;",
    'esac'
  ]
}

/** Captures the post's reply; a failed curl's partial body is dropped, spooled and answered `{}`. */
export function wrapPosixClaudeDecisionPost(postLines: readonly string[]): string[] {
  return [
    ...postLines.map((line, index) =>
      index === 0
        ? `occ_hook_reply=$(${line}`
        : index === postLines.length - 1
          ? `${line} 2>/dev/null) || { occ_hook_reply=; spool_hook_event; }`
          : line
    ),
    'case "$occ_hook_reply" in \'{"hookSpecificOutput":{"hookEventName":"PreToolUse"\'*\'}}\') occ_hook_answer=$occ_hook_reply ;; esac'
  ]
}
