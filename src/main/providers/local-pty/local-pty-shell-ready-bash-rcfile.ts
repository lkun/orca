/** Bash has one --rcfile wrapper, so login startup, OSC hooks and readiness share this file. */
import { BASH_PROMPT_COMMAND_COMPOSITION_BLOCK } from '../../bash-prompt-command-composition'
import { OCC_CLI_POSIX_PATH_RESTORE } from '../../../shared/occ-cli-shell-path'
import { MANAGED_DATA_ACCOUNT_POSIX_RESTORE } from '../../../shared/managed-data-account-shell'
import { WSL_MANAGED_CLI_PATH_RESTORE } from '../../wsl-managed-cli-path-restore'
import { getPosixOmpShellWrapper } from '../../pty/omp-shell-wrapper'
import { getPosixCodexShellLaunchPreflight } from '../../../shared/codex-shell-function'
import { getPosixClaudeShellFunction } from '../../../shared/claude-shell-function'
import { getBashStartupCommandPromptBlock } from '../../pty/posix-shell-startup-command'
import {
  BASH_FEATURE_CHANNEL_BLOCK,
  SHELL_STARTUP_IDENTITY_MARKER_BLOCK
} from '../../shell-templates'
import { SHELL_READY_MARKER_ESCAPED } from './local-pty-shell-ready-marker'
import { BASH_WSL_CWD_REPORT_BLOCK } from '../../wsl-shell-cwd-report'

export function getBashShellReadyRcfileContent(): string {
  return `# OCC bash shell-ready wrapper
${BASH_FEATURE_CHANNEL_BLOCK}
${SHELL_STARTUP_IDENTITY_MARKER_BLOCK}
# Consume feature selection before startup files can inherit it into children.
__occ_ready_marker=""
__occ_has_feature ready && __occ_ready_marker=1
unset _occ_shell_features
unset -f __occ_has_feature
[[ -f /etc/profile ]] && source /etc/profile
if [[ -f "$HOME/.bash_profile" ]]; then
  source "$HOME/.bash_profile"
elif [[ -f "$HOME/.bash_login" ]]; then
  source "$HOME/.bash_login"
elif [[ -f "$HOME/.profile" ]]; then
  source "$HOME/.profile"
fi
# Older readline needs explicit bracketed paste so multiline prompts do not submit each newline.
[[ $- == *i* ]] && bind 'set enable-bracketed-paste on' 2>/dev/null
# Login profiles may already source .bashrc; sourcing it again would duplicate PATH, hooks and prompt setup.
__occ_restore_agent_teams_path() {
  [[ -n "\${OCC_AGENT_TEAMS_SHIM_DIR:-}" ]] || return 0
  case "$PATH" in
    "\${OCC_AGENT_TEAMS_SHIM_DIR}"|"\${OCC_AGENT_TEAMS_SHIM_DIR}:"*) return 0 ;;
  esac
  export PATH="\${OCC_AGENT_TEAMS_SHIM_DIR}:$PATH"
}
__occ_restore_agent_teams_path
${OCC_CLI_POSIX_PATH_RESTORE}
${WSL_MANAGED_CLI_PATH_RESTORE}
# Restore OCC-managed config after user startup files may override it.
[[ -n "\${OCC_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${OCC_OPENCODE_CONFIG_DIR}"
${MANAGED_DATA_ACCOUNT_POSIX_RESTORE}
[[ -n "\${OCC_MIMOCODE_CONFIG_DIR:-}" ]] && export MIMOCODE_CONFIG_DIR="\${OCC_MIMOCODE_CONFIG_DIR}"
${getPosixOmpShellWrapper()}
# Profile scripts must not replace OCC's runtime CODEX_HOME.
[[ -n "\${OCC_CODEX_HOME:-}" ]] && export CODEX_HOME="\${OCC_CODEX_HOME}"
${getPosixCodexShellLaunchPreflight() + getPosixClaudeShellFunction()}
${BASH_WSL_CWD_REPORT_BLOCK}
# OSC 133 C/D clears agent status after interrupted CLIs exit without sending Stop/SessionEnd hooks.
__occ_initializing_wrapper=1
__occ_osc133_precmd() {
  local exit_code=$?
  __occ_in_prompt_command=1
  if [[ -n "\${__occ_in_command:-}" ]]; then
    printf "\\033]133;D;%s\\007" "$exit_code"
    unset __occ_in_command
  fi
  printf "\\033]133;A\\007"
  __occ_wsl_cwd_report
  return "$exit_code"
}
__occ_osc133_prompt_done() {
  unset __occ_in_prompt_command
  __occ_adopt_outer_debug_trap
  trap '__occ_osc133_preexec' DEBUG
}
__occ_osc133_preexec() {
  if [[ -n "\${__occ_prompt_status_capture_command:-}" && "$BASH_COMMAND" == "$__occ_prompt_status_capture_command" ]]; then
    unset __occ_initial_prompt
    __occ_in_legacy_prompt_wrapper=1
    return 0
  fi
  if [[ -n "\${__occ_initializing_wrapper:-}\${__occ_in_debug_capture:-}\${__occ_initial_prompt:-}\${__occ_in_prompt_dispatch:-}\${__occ_in_legacy_prompt_wrapper:-}\${__occ_in_prompt_command:-}" ]]; then
    [[ -z "\${__occ_initializing_wrapper:-}\${__occ_in_debug_capture:-}" ]] || return 0
    if [[ -n "\${__occ_initial_prompt:-}" && "$BASH_COMMAND" == "__occ_osc133_precmd" ]]; then
      unset __occ_initial_prompt; return 0
    fi
    if [[ -n "\${__occ_in_prompt_dispatch:-}" ]]; then
      [[ -n "\${__occ_dispatching_user_prompt_command:-}" ]] || return 0
      if [[ "\${FUNCNAME[1]:-}" == "__occ_run_prompt_command_array" ]]; then
        case "$BASH_COMMAND" in
          '(( __occ_exit_code == 0 ))'|'__occ_restore_prompt_status "$__occ_exit_code"'|'eval "$__occ_prompt_part"'|'eval "$__occ_final_prompt_command"'|__occ_dispatching_user_prompt_command=*|__occ_osc133_precmd|__occ_osc133_prompt_done|__occ_prompt_mark) return 0 ;;
        esac
      fi
    elif [[ "\${FUNCNAME[1]:-}" == "__occ_run_prompt_command_array" || "$BASH_COMMAND" == "__occ_run_prompt_command_array" ]]; then
      return 0
    fi
    [[ -z "\${__occ_in_legacy_prompt_wrapper:-}" || -n "\${__occ_dispatching_user_prompt_command:-}" ]] || return 0
    if [[ -n "\${__occ_in_prompt_command:-}" && "$BASH_COMMAND" == "__occ_in_debug_capture=1" ]]; then
      return 0
    fi
  fi
  case "\${FUNCNAME[1]:-}" in __occ_osc133_*|__occ_prompt_mark|__occ_restore_prompt_status) return 0 ;; esac
  case "$BASH_COMMAND" in __occ_osc133_precmd|__occ_osc133_prompt_done|__occ_prompt_mark) return 0 ;; esac
  __occ_run_user_debug_trap
  [[ -z "\${__occ_in_prompt_command:-}" ]] || return 0
  [[ -z "\${__occ_in_command:-}" ]] || return 0
  # DEBUG runs per simple command; chained traps may reenter for the same foreground command.
  printf "\\033]133;C\\007"
  __occ_in_command=1
}
# Capture $? before the user's PROMPT_COMMAND chain mutates it.
${BASH_PROMPT_COMMAND_COMPOSITION_BLOCK}
__occ_prepend_prompt_command "__occ_osc133_precmd"
# Mark readiness after user prompt setup without rerunning startup files.
if [[ -n "$__occ_ready_marker" ]]; then
  __occ_prompt_mark() {
    printf "${SHELL_READY_MARKER_ESCAPED}"
  }
  __occ_append_prompt_command "__occ_prompt_mark"
fi
__occ_append_prompt_command '__occ_in_debug_capture=1; __occ_prompt_had_functrace=""; if [[ -o functrace ]]; then __occ_prompt_had_functrace=1; set +T; fi; __occ_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__occ_prompt_had_functrace" ]] || set -T; unset __occ_prompt_had_functrace __occ_in_debug_capture'
__occ_append_prompt_command "__occ_osc133_prompt_done"
${getBashStartupCommandPromptBlock()}
__occ_had_functrace=""
[[ -o functrace ]] && __occ_had_functrace=1
set +T
__occ_debug_trap_spec="$(trap -p DEBUG)"
[[ -z "$__occ_had_functrace" ]] || set -T
if [[ -n "$__occ_debug_trap_spec" && "$__occ_debug_trap_spec" != "trap -- '__occ_osc133_preexec' DEBUG" ]]; then
  __occ_debug_trap_command="\${__occ_debug_trap_spec#trap -- }"
  __occ_debug_trap_command="\${__occ_debug_trap_command% DEBUG}"
  eval "__occ_user_debug_trap=$__occ_debug_trap_command"
fi
unset __occ_debug_trap_spec __occ_debug_trap_command __occ_had_functrace
unset -f __occ_normalize_prompt_command_part __occ_normalize_prompt_command __occ_prepend_prompt_command __occ_append_prompt_command
unset __occ_prompt_command_normalized
# Arm DEBUG after wrapper setup to avoid fake foreground C/D events before the first prompt.
__occ_initial_prompt=1
trap '__occ_osc133_preexec' DEBUG
unset __occ_initializing_wrapper
`
}
