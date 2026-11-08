// Typed OMP needs OCC's status extension explicitly; preserve PI_CODING_AGENT_DIR as the user's mutable auth/config/session home.

const OMP_SUBCOMMANDS = [
  '__complete',
  'acp',
  'agents',
  'auth-broker',
  'auth-gateway',
  'bench',
  'commit',
  'completions',
  'config',
  'dry-balance',
  'gallery',
  'grep',
  'grievances',
  'install',
  'join',
  'models',
  'plugin',
  'read',
  'say',
  'search',
  'setup',
  'shell',
  'ssh',
  'stats',
  'tiny-models',
  'token',
  'ttsr',
  'update',
  'usage',
  'worktree',
  'q',
  'wt'
] as const

export function getPosixOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.map((value) => `'${value}'`).join('|')
  return `# Why: OMP does not auto-load OCC's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
__occ_omp_should_skip_extension() {
  case "\${1:-}" in
    'help'|'--help'|'-h'|'--version'|'-v') return 0 ;;
    ${subcommands}) return 0 ;;
  esac
  return 1
}
__occ_omp_cwd_is_usable() {
  local __occ_physical_cwd
  [[ -x . ]] || return 1
  if [[ -n "\${PWD:-}" && -d "\${PWD:-}" ]]; then
    [[ "\${PWD}" -ef . ]]
  else
    # Why compare the path: shell builtins can print a cached path for a deleted cwd.
    __occ_physical_cwd="$(builtin pwd -P 2>/dev/null)" || return 1
    [[ -d "$__occ_physical_cwd" && "$__occ_physical_cwd" -ef . ]]
  fi
}
__occ_omp_invoke() {
  local __occ_use_extension="$1"
  shift
  if [[ $__occ_use_extension -eq 1 && -n "\${OCC_OMP_STATUS_EXTENSION:-}" && -f "\${OCC_OMP_STATUS_EXTENSION}" ]]; then
    if [[ "\${1:-}" == "launch" ]]; then
      shift
      command omp launch --extension "\${OCC_OMP_STATUS_EXTENSION}" "$@"
    else
      command omp --extension "\${OCC_OMP_STATUS_EXTENSION}" "$@"
    fi
  else
    command omp "$@"
  fi
}
__occ_omp() {
  local __occ_use_extension=1
  __occ_omp_should_skip_extension "\${1:-}" && __occ_use_extension=0
  if ! __occ_omp_cwd_is_usable; then
    local __occ_logical_cwd="\${PWD:-\${OCC_WORKTREE_PATH:-\${OCC_ROOT_PATH:-}}}"
    # Why: a restored shell can retain the deleted directory inode after its path is recreated.
    (
      if [[ -z "$__occ_logical_cwd" ]]; then
        printf 'OCC: OMP cannot start because no terminal working directory is available. Open a new terminal in an existing directory.\\n' >&2
        return 1
      fi
      if ! builtin cd -P -- "$__occ_logical_cwd" 2>/dev/null; then
        printf 'OCC: OMP cannot access the terminal working directory "%s". Open a new terminal in an existing directory.\\n' "$__occ_logical_cwd" >&2
        return 1
      fi
      __occ_omp_invoke "$__occ_use_extension" "$@"
    )
  else
    __occ_omp_invoke "$__occ_use_extension" "$@"
  fi
}
if [[ -n "\${OCC_OMP_STATUS_EXTENSION:-}" ]]; then
  # Why the function reserved word: it suppresses alias expansion of the name, which
  # an \`alias omp\` otherwise rewrites at parse time, aborting the rest of the file.
  function omp { __occ_omp "$@"; }
fi
`
}

export function getPowerShellOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.map((value) => `'${value}'`).join(', ')
  return `# Why: OMP does not auto-load OCC's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
function Global:__OCCOmpShouldSkipExtension {
    param([string]$Name)
    $skip = @("help", "--help", "-h", "--version", "-v") + @(${subcommands})
    return $skip -contains $Name
}
if ($env:OCC_OMP_STATUS_EXTENSION) {
    function Global:omp {
        $occUseExtension = -not (__OCCOmpShouldSkipExtension -Name ([string]($args[0])))
        $occStatus = 0
        $occCommand = Get-Command omp -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $occCommand) {
            Write-Error "omp executable not found"
            $occStatus = 127
        } elseif ($occUseExtension -and $env:OCC_OMP_STATUS_EXTENSION -and
            (Test-Path -LiteralPath $env:OCC_OMP_STATUS_EXTENSION)) {
            if ($args.Count -gt 0 -and $args[0] -eq "launch") {
                $occLaunchArgs = @($args | Select-Object -Skip 1)
                & $occCommand.Source launch --extension $env:OCC_OMP_STATUS_EXTENSION @occLaunchArgs
            } else {
                & $occCommand.Source --extension $env:OCC_OMP_STATUS_EXTENSION @args
            }
            $occStatus = $LASTEXITCODE
        } else {
            & $occCommand.Source @args
            $occStatus = $LASTEXITCODE
        }

        $global:LASTEXITCODE = $occStatus
    }
}
`
}
