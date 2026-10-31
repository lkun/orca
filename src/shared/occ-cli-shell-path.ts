export const OCC_CLI_POSIX_PATH_RESTORE = `if [ -n "\${OCC_CLI_BIN_DIR:-}" ]; then
  case "\${PATH:-}" in
    "$OCC_CLI_BIN_DIR"|"$OCC_CLI_BIN_DIR":*) ;;
    *) export PATH="$OCC_CLI_BIN_DIR\${PATH:+:$PATH}" ;;
  esac
fi`
