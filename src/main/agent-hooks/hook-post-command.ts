import type { AgentHookSource } from '../../shared/agent-hook-listener/transport/agent-hook-relay'
import { OCC_HOOK_RAW_JSON_TRANSPORT } from '../../shared/agent-hook-listener/configuration/agent-hook-types'
import { AGENT_HOOK_METADATA_CACHE_DIR } from '../../shared/agent-hook-listener/transport/agent-hook-spool'

// Older curl needs C numeric parsing; keep the parent script's UTF-8 locale unchanged.
export function posixCurlCommand(curlCommand = 'curl'): string {
  return `LC_ALL= LC_NUMERIC=C ${curlCommand}`
}

const PACK_HOOK_METADATA = `printf '%s\\037%s\\037%s\\037%s\\037%s\\037%s' "$OCC_PANE_KEY" "$OCC_TAB_ID" "$OCC_AGENT_LAUNCH_TOKEN" "$OCC_WORKTREE_ID" "$OCC_AGENT_HOOK_ENV" "$OCC_AGENT_HOOK_VERSION" | base64 | tr -d '\\n'`

/** Defines `occ_hook_pack_metadata`, which reuses a pane's packed header while every input matches. */
export function buildPosixHookMetadataCacheLines(): string[] {
  return [
    'occ_hook_pack_metadata() {',
    // Length prefixes keep different inputs from forming the same key.
    '  occ_hook_meta_key="${#OCC_PANE_KEY}:$OCC_PANE_KEY ${#OCC_TAB_ID}:$OCC_TAB_ID ${#OCC_AGENT_LAUNCH_TOKEN}:$OCC_AGENT_LAUNCH_TOKEN ${#OCC_WORKTREE_ID}:$OCC_WORKTREE_ID ${#OCC_AGENT_HOOK_ENV}:$OCC_AGENT_HOOK_ENV ${#OCC_AGENT_HOOK_VERSION}:$OCC_AGENT_HOOK_VERSION"',
    '  occ_hook_meta_file=',
    // A stale variable must not create state for an absent OCC installation.
    '  if [ -r "${OCC_AGENT_HOOK_ENDPOINT:-}" ]; then',
    '    occ_hook_meta_id=$OCC_PANE_KEY',
    // Name it like the spool file, which may sit on a Windows drive under WSL.
    '    while :; do case "$occ_hook_meta_id" in *[/:]*) occ_hook_meta_id="${occ_hook_meta_id%%[/:]*}_${occ_hook_meta_id#*[/:]}" ;; *) break ;; esac; done',
    `    occ_hook_meta_file="\${OCC_AGENT_HOOK_ENDPOINT%/*}/${AGENT_HOOK_METADATA_CACHE_DIR}/pane-$occ_hook_meta_id"`,
    '    occ_hook_meta_line=',
    '    IFS= read -r occ_hook_meta_line 2>/dev/null < "$occ_hook_meta_file"',
    '    occ_hook_metadata=${occ_hook_meta_line%% *}',
    '    [ -z "$occ_hook_metadata" ] || [ "${occ_hook_meta_line#* }" != "$occ_hook_meta_key" ] || return 0',
    '  fi',
    `  occ_hook_metadata=$(${PACK_HOOK_METADATA}) && [ -n "$occ_hook_metadata" ] || return 1`,
    '  [ -n "$occ_hook_meta_file" ] || return 0',
    '  [ -d "${occ_hook_meta_file%/*}" ] || mkdir -m 700 "${occ_hook_meta_file%/*}" 2>/dev/null || return 0',
    // Rename so a concurrent event never reads half a line.
    `  printf '%s %s\\n' "$occ_hook_metadata" "$occ_hook_meta_key" 2>/dev/null > "$occ_hook_meta_file.$$" && mv -f "$occ_hook_meta_file.$$" "$occ_hook_meta_file" 2>/dev/null`,
    '  return 0',
    '}'
  ]
}

type PosixAgentHookPostOptions = {
  curlCommand?: string
  indent?: string
  decisionHeaderVar?: string
  /** Take the header from `buildPosixHookMetadataCacheLines` instead of packing it every event. */
  cachedMetadata?: boolean
}

export function buildPosixAgentHookPostCommand(
  source: AgentHookSource,
  options: PosixAgentHookPostOptions = {}
): string[] {
  const curlCommand = posixCurlCommand(options.curlCommand ?? 'curl')
  const indent = options.indent ?? '  '
  // Only Claude's capture sets this; the host checks the attachment itself before trusting it.
  const tmux = source === 'claude'
  // Names the decision format the script prints; absent, OCC never waits on plugins.
  const decision = options.decisionHeaderVar
    ? [`  ${indent}-H "X-OCC-Hook-Decision: \${${options.decisionHeaderVar}:-}" \\`]
    : []
  const url = `"http://127.0.0.1:\${OCC_AGENT_HOOK_PORT}/hook/${source}"`
  const packMetadata = options.cachedMetadata
    ? ['  occ_hook_pack_metadata && \\']
    : [
        `  occ_hook_metadata=$(${PACK_HOOK_METADATA}) && \\`,
        '  [ -n "$occ_hook_metadata" ] && \\'
      ]
  return [
    `if [ "\${OCC_AGENT_HOOK_TRANSPORT:-}" = "${OCC_HOOK_RAW_JSON_TRANSPORT}" ] && command -v base64 >/dev/null 2>&1 && command -v tr >/dev/null 2>&1; then`,
    ...packMetadata,
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST ${url} \\`,
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
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST ${url} \\`,
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
