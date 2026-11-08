export const BASH_PROMPT_COMMAND_COMPOSITION_BLOCK = `__occ_normalize_prompt_command_part() {
  local __occ_value="$1" __occ_output_name="$2" __occ_character __occ_chunk
  local __occ_value_length=\${#1} __occ_suffix_length=0 __occ_backslash_length=0
  local __occ_output_length __occ_scan_start
  while (( __occ_value_length - __occ_suffix_length >= 1024 )); do
    __occ_scan_start=$(( __occ_value_length - __occ_suffix_length - 1024 ))
    __occ_chunk="\${__occ_value:__occ_scan_start:1024}"
    case "$__occ_chunk" in
      *[!$' \\t\\n;']*) break ;;
      *) __occ_suffix_length=$(( __occ_suffix_length + 1024 )) ;;
    esac
  done
  while (( __occ_suffix_length < __occ_value_length )); do
    __occ_character="\${__occ_value: -__occ_suffix_length - 1:1}"
    case "$__occ_character" in
      ' '|$'\\t'|$'\\n'|';') __occ_suffix_length=$(( __occ_suffix_length + 1 )) ;;
      *) break ;;
    esac
  done
  __occ_output_length=$(( \${#__occ_value} - __occ_suffix_length ))
  while (( __occ_output_length - __occ_backslash_length >= 1024 )); do
    __occ_scan_start=$(( __occ_output_length - __occ_backslash_length - 1024 ))
    __occ_chunk="\${__occ_value:__occ_scan_start:1024}"
    case "$__occ_chunk" in
      *[!\\\\]*) break ;;
      *) __occ_backslash_length=$(( __occ_backslash_length + 1024 )) ;;
    esac
  done
  while (( __occ_backslash_length < __occ_output_length )); do
    __occ_character="\${__occ_value:__occ_output_length - __occ_backslash_length - 1:1}"
    [[ "$__occ_character" == '\\' ]] || break
    __occ_backslash_length=$(( __occ_backslash_length + 1 ))
  done
  # Preserve the first separator when an odd backslash run escapes it.
  if (( __occ_suffix_length > 0 && __occ_backslash_length % 2 == 1 )); then
    __occ_suffix_length=$(( __occ_suffix_length - 1 ))
    __occ_backslash_length=0
  fi
  __occ_output_length=$(( \${#__occ_value} - __occ_suffix_length ))
  __occ_value="\${__occ_value:0:__occ_output_length}"
  # Bash 4.4-5.0 scalar prompt evaluation preserves an odd terminal backslash.
  if (( __occ_suffix_length == 0 && ((BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] == 0)) && __occ_backslash_length % 2 == 1 )); then
    __occ_value="$__occ_value\\\\"
  fi
  printf -v "$__occ_output_name" '%s' "$__occ_value"
}
__occ_restore_prompt_status() {
  return "$1"
}
__occ_update_user_debug_trap() {
  local __occ_debug_trap_spec="$1" __occ_unchanged_debug_trap_spec="$2"
  local __occ_debug_trap_command
  [[ "$__occ_debug_trap_spec" != "$__occ_unchanged_debug_trap_spec" ]] || return 0
  [[ "$__occ_debug_trap_spec" != "trap -- '__occ_osc133_preexec' DEBUG" ]] || return 0
  if [[ -z "$__occ_debug_trap_spec" ]]; then
    __occ_user_debug_trap=""
    unset __occ_chained_debug_trap
    return 0
  fi
  __occ_debug_trap_command="\${__occ_debug_trap_spec#trap -- }"
  __occ_debug_trap_command="\${__occ_debug_trap_command% DEBUG}"
  eval "__occ_user_debug_trap=$__occ_debug_trap_command"
  unset __occ_chained_debug_trap
}
__occ_run_user_debug_trap() {
  if [[ -n "\${__occ_user_debug_trap:-}" ]]; then
    eval "$__occ_user_debug_trap" || true
  fi
}
__occ_adopt_outer_debug_trap() {
  local __occ_debug_trap_spec="\${__occ_outer_debug_trap_spec:-}"
  unset __occ_outer_debug_trap_spec
  __occ_update_user_debug_trap "$__occ_debug_trap_spec" "trap -- '__occ_osc133_preexec' DEBUG"
}
__occ_run_prompt_command_array() {
  local __occ_exit_code="\${__occ_prompt_status:-$?}" __occ_prompt_part __occ_prompt_index __occ_user_count
  local __occ_suffix_part
  local __occ_final_prompt_command
  local __occ_in_prompt_dispatch=1 __occ_dispatching_user_prompt_command=""
  unset __occ_prompt_status
  __occ_adopt_outer_debug_trap
  trap '__occ_osc133_preexec' DEBUG
  for __occ_prompt_part in "\${__occ_prompt_command_prefix[@]+"\${__occ_prompt_command_prefix[@]}"}"; do
    if (( __occ_exit_code == 0 )); then
      eval "$__occ_prompt_part"
    else
      __occ_restore_prompt_status "$__occ_exit_code" || eval "$__occ_prompt_part"
    fi
  done
  __occ_user_count=0
  for __occ_prompt_part in "\${__occ_prompt_command_array[@]+"\${__occ_prompt_command_array[@]}"}"; do
    __occ_user_count=$(( __occ_user_count + 1 ))
  done
  for (( __occ_prompt_index = 0; __occ_prompt_index + 1 < __occ_user_count; __occ_prompt_index++ )); do
    __occ_prompt_part="\${__occ_prompt_command_array[__occ_prompt_index]}"
    __occ_dispatching_user_prompt_command=1
    if (( __occ_exit_code == 0 )); then
      eval "$__occ_prompt_part"
    else
      __occ_restore_prompt_status "$__occ_exit_code" || eval "$__occ_prompt_part"
    fi
    __occ_dispatching_user_prompt_command=""
  done
  if (( __occ_user_count > 0 )); then
    __occ_prompt_part="\${__occ_prompt_command_array[__occ_user_count - 1]}"
    # Why: keep the final user hook and OCC suffixes in one status-preserving eval.
    __occ_final_prompt_command='eval "$__occ_prompt_part"'
    for __occ_suffix_part in "\${__occ_prompt_command_suffix[@]+"\${__occ_prompt_command_suffix[@]}"}"; do
      __occ_final_prompt_command+=$'\\n'"$__occ_suffix_part"
    done
    __occ_dispatching_user_prompt_command=1
    if (( __occ_exit_code == 0 )); then
      eval "$__occ_final_prompt_command"
    else
      __occ_restore_prompt_status "$__occ_exit_code" || eval "$__occ_final_prompt_command"
    fi
    __occ_dispatching_user_prompt_command=""
  else
    for __occ_prompt_part in "\${__occ_prompt_command_suffix[@]+"\${__occ_prompt_command_suffix[@]}"}"; do
      if (( __occ_exit_code == 0 )); then
        eval "$__occ_prompt_part"
      else
        __occ_restore_prompt_status "$__occ_exit_code" || eval "$__occ_prompt_part"
      fi
    done
  fi
  return "$__occ_exit_code"
}
__occ_finish_legacy_prompt_dispatch() {
  local __occ_suffix_part
  if [[ -n "\${__occ_in_prompt_command:-}" ]]; then
    for __occ_suffix_part in "\${__occ_prompt_command_suffix[@]+"\${__occ_prompt_command_suffix[@]}"}"; do
      eval "$__occ_suffix_part"
    done
  fi
}
__occ_normalize_prompt_command() {
  [[ -z "\${__occ_prompt_command_normalized:-}" ]] || return 0
  local __occ_prompt_part
  local -a __occ_normalized=()
  for __occ_prompt_part in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
    __occ_normalize_prompt_command_part "$__occ_prompt_part" __occ_prompt_part
    [[ -n "$__occ_prompt_part" ]] && __occ_normalized+=("$__occ_prompt_part")
  done
  __occ_prompt_command_normalized=1
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("\${__occ_normalized[@]+"\${__occ_normalized[@]}"}")
  else
    __occ_prompt_command_array=("\${__occ_normalized[@]+"\${__occ_normalized[@]}"}")
    __occ_prompt_command_prefix=()
    __occ_prompt_command_suffix=()
    unset PROMPT_COMMAND
    # Why: PID scope distinguishes legacy prompt dispatch from ordinary user command text.
    __occ_prompt_status_variable="__occ_prompt_status_$$"
    __occ_prompt_status_capture_command="$__occ_prompt_status_variable=\\$?"
    __occ_prompt_status_value="\\\${$__occ_prompt_status_variable}"
    # Why: a changed DEBUG trap misses the capture command, and bash <= 4.3 reverts traps set in functions.
    PROMPT_COMMAND="$__occ_prompt_status_capture_command; __occ_in_legacy_prompt_wrapper=1; __occ_prompt_status=$__occ_prompt_status_value"'; __occ_prompt_had_functrace=""; if [[ -o functrace ]]; then __occ_prompt_had_functrace=1; set +T; fi; __occ_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__occ_prompt_had_functrace" ]] || set -T; unset __occ_prompt_had_functrace; __occ_run_prompt_command_array; __occ_finish_legacy_prompt_dispatch; trap __occ_osc133_preexec DEBUG; unset __occ_in_legacy_prompt_wrapper'
  fi
}
__occ_prepend_prompt_command() {
  local command="$1"
  __occ_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("$command" "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}")
  else
    __occ_prompt_command_prefix=("$command" "\${__occ_prompt_command_prefix[@]+"\${__occ_prompt_command_prefix[@]}"}")
  fi
}
__occ_append_prompt_command() {
  local command="$1"
  __occ_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND+=("$command")
  else
    __occ_prompt_command_suffix+=("$command")
  fi
}`
