import { basename, win32 as pathWin32 } from 'node:path'

export const POSIX_SHELL_STARTUP_COMMAND_ENV = 'OCC_POSIX_SHELL_STARTUP_COMMAND'

export function supportsPosixShellStartupCommand(shellPath: string): boolean {
  const shellName = pathWin32.basename(basename(shellPath)).toLowerCase()
  return shellName === 'bash' || shellName === 'zsh' || shellName === 'fish'
}

export function getBashStartupCommandPromptBlock(): string {
  return `if [[ \${${POSIX_SHELL_STARTUP_COMMAND_ENV}+present} == present ]]; then
  __occ_remove_startup_command_prompt_hook() {
    local __occ_item
    local -a __occ_remaining=()
    if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
      for __occ_item in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
        [[ "$__occ_item" == "__occ_run_startup_command" ]] || __occ_remaining+=("$__occ_item")
      done
      PROMPT_COMMAND=("\${__occ_remaining[@]+"\${__occ_remaining[@]}"}")
    else
      for __occ_item in "\${__occ_prompt_command_suffix[@]+"\${__occ_prompt_command_suffix[@]}"}"; do
        [[ "$__occ_item" == "__occ_run_startup_command" ]] || __occ_remaining+=("$__occ_item")
      done
      __occ_prompt_command_suffix=("\${__occ_remaining[@]+"\${__occ_remaining[@]}"}")
    fi
  }
  __occ_run_startup_command() {
    local __occ_command="$${POSIX_SHELL_STARTUP_COMMAND_ENV}" __occ_status
    unset ${POSIX_SHELL_STARTUP_COMMAND_ENV}
    __occ_remove_startup_command_prompt_hook
    unset -f __occ_remove_startup_command_prompt_hook
    builtin history -s "$__occ_command" 2>/dev/null || true
    builtin printf '%s\n' "$__occ_command"
    eval "$__occ_command"
    __occ_status=$?
    unset -f __occ_run_startup_command
    return "$__occ_status"
  }
  __occ_append_prompt_command "__occ_run_startup_command"
fi`
}
