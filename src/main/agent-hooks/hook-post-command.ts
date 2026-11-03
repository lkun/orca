import type { AgentHookSource } from '../../shared/agent-hook-relay'
import { OCC_HOOK_RAW_JSON_TRANSPORT } from '../../shared/agent-hook-types'

// Older curl needs C numeric parsing; keep the parent script's UTF-8 locale unchanged.
export function posixCurlCommand(curlCommand = 'curl'): string {
  return `LC_ALL= LC_NUMERIC=C ${curlCommand}`
}

export function buildPosixAgentHookPostCommand(
  source: AgentHookSource,
  options: { curlCommand?: string; indent?: string; decisionHeaderVar?: string } = {}
): string[] {
  const curlCommand = posixCurlCommand(options.curlCommand ?? 'curl')
  const indent = options.indent ?? '  '
  // Only Claude's capture sets this; the host checks the attachment itself before trusting it.
  const tmux = source === 'claude'
  // Names the decision format the script prints; absent, OCC never waits on plugins.
  const decision = options.decisionHeaderVar
    ? [`  ${indent}-H "X-OCC-Hook-Decision: \${${options.decisionHeaderVar}:-}" \\`]
    : []
  return [
    `if [ "\${OCC_AGENT_HOOK_TRANSPORT:-}" = "${OCC_HOOK_RAW_JSON_TRANSPORT}" ] && command -v base64 >/dev/null 2>&1 && command -v tr >/dev/null 2>&1; then`,
    `  occ_hook_metadata=$(printf '%s\\037%s\\037%s\\037%s\\037%s\\037%s' "$OCC_PANE_KEY" "$OCC_TAB_ID" "$OCC_AGENT_LAUNCH_TOKEN" "$OCC_WORKTREE_ID" "$OCC_AGENT_HOOK_ENV" "$OCC_AGENT_HOOK_VERSION" | base64 | tr -d '\\n') && \\`,
    `  [ -n "$occ_hook_metadata" ] && \\`,
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST "http://127.0.0.1:\${OCC_AGENT_HOOK_PORT}/hook/${source}" \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/json" \\`,
    `  ${indent}-H "X-OCC-Agent-Hook-Token: \${OCC_AGENT_HOOK_TOKEN}" \\`,
    `  ${indent}-H "X-OCC-Agent-Hook-Meta-Encoding: base64" \\`,
    `  ${indent}-H "X-OCC-Agent-Hook-Meta: \${occ_hook_metadata}" \\`,
    `  ${indent}-H "X-OCC-Agent-Process: \${occ_agent_process:-}" \\`,
    ...(tmux ? [`  ${indent}-H "X-OCC-Tmux-Pane: \${occ_tmux_pane:-}" \\`] : []),
    ...decision,
    `  ${indent}--data-binary @-`,
    'else',
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST "http://127.0.0.1:\${OCC_AGENT_HOOK_PORT}/hook/${source}" \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/x-www-form-urlencoded" \\`,
    `  ${indent}-H "X-OCC-Agent-Hook-Token: \${OCC_AGENT_HOOK_TOKEN}" \\`,
    ...decision,
    `  ${indent}--data-urlencode "paneKey=\${OCC_PANE_KEY}" \\`,
    `  ${indent}--data-urlencode "tabId=\${OCC_TAB_ID}" \\`,
    `  ${indent}--data-urlencode "launchToken=\${OCC_AGENT_LAUNCH_TOKEN}" \\`,
    `  ${indent}--data-urlencode "worktreeId=\${OCC_WORKTREE_ID}" \\`,
    `  ${indent}--data-urlencode "env=\${OCC_AGENT_HOOK_ENV}" \\`,
    `  ${indent}--data-urlencode "version=\${OCC_AGENT_HOOK_VERSION}" \\`,
    `  ${indent}--data-urlencode "agentProcess=\${occ_agent_process:-}" \\`,
    ...(tmux ? [`  ${indent}--data-urlencode "tmuxPane=\${occ_tmux_pane:-}" \\`] : []),
    `  ${indent}--data-urlencode "payload@-"`,
    'fi'
  ]
}
