/** Leads PATH with the managed WSL CLI after startup files ran; an unusable CLI only warns. */
export const WSL_MANAGED_CLI_PATH_RESTORE = `if [ -n "\${OCC_WSL_CLI_DIR:-}" ]; then
  if [ -x "$OCC_WSL_CLI_DIR/\${OCC_CLI_COMMAND:-}" ]; then
    export PATH="$OCC_WSL_CLI_DIR\${PATH:+:$PATH}"
  else
    printf 'OCC CLI unavailable: cannot run %s. Check WSL Windows-drive mount options.\\n' "$OCC_WSL_CLI_DIR/\${OCC_CLI_COMMAND:-}" >&2
  fi
fi`
