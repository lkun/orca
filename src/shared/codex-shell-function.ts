import {
  CODEX_REMOTE_VIEWER_SSH_CONNECTION,
  REMOTE_VIEWER_CLIPBOARD_ENV
} from './remote-viewer-clipboard-env'

// Embed launch-prep/--no-daemon wrappers on all hosts. Codex 0.156+ otherwise shares CODEX_HOME servers with the first tab’s OCC hooks/env and lifetime (#22873). agents/queue/--remote require sharing; any -c opts out.
const CODEX_SHARED_SERVER_ARGS = ['agents', 'queue', '--remote'] as const
export const CODEX_NO_DAEMON_SKIP_ARGS = [...CODEX_SHARED_SERVER_ARGS, '--no-daemon'] as const
const argPattern = (args: readonly string[]): string => `^(${args.join('|')}|--remote=.*)$`
const CODEX_SHARED_SERVER_ARG_PATTERN = argPattern(CODEX_SHARED_SERVER_ARGS)
const CODEX_NO_DAEMON_SKIP_ARG_PATTERN = argPattern(CODEX_NO_DAEMON_SKIP_ARGS)

/** Restore nonsecret OCC caller identity stripped by inherit=core (#25775). set overrides inherit/exclude but include_only still wins; never send tokens through locally readable argv. */
export const CODEX_COMMAND_IDENTITY_ENV_KEYS = [
  'OCC_TERMINAL_HANDLE',
  'OCC_PANE_KEY',
  'OCC_WORKTREE_ID',
  'OCC_WORKSPACE_ID',
  'OCC_USER_DATA_PATH'
] as const

// Skip apostrophes: TOML literals cannot hold them and Codex parse fallback may truncate paths; missing identity is safer than wrong identity.
const identitySetArg = (key: string, value: string): string =>
  `shell_environment_policy.set.${key}='${value}'`

export function getPosixCodexShellLaunchPreflight(): string {
  return `# Why: a typed alias expands inside the shell, after pane launch prep.
# Why unalias inside the substitution: an alias named codex makes command -v
# report the alias text, and the subshell leaves the user's own alias intact.
# Why || : twice — zsh alone aborts inside the substitution, but every shell's
# assignment adopts its exit status, so an absent codex trips set -e in bash too.
__occ_codex_binary="$(unalias codex 2>/dev/null || :; command -v codex 2>/dev/null || :)"
if [[ -n "\${__occ_codex_binary:-}" && -x "\${__occ_codex_binary}" ]]; then
  # Why the function reserved word: it suppresses alias expansion of the name,
  # which otherwise rewrites this header at parse time and aborts the whole file.
  function codex {
    # Why local: zsh's warn_create_global warns for each global a function creates.
    local __occ_codex_arg __occ_codex_isolate="\${OCC_CODEX_ISOLATE:-1}" __occ_codex_identity="\${OCC_CODEX_ISOLATE:-1}"
    if [[ "\${${REMOTE_VIEWER_CLIPBOARD_ENV}:-}" == 1 && -z "\${SSH_CONNECTION+x}" && -z "\${SSH_TTY+x}" ]]; then
      local -x SSH_CONNECTION='${CODEX_REMOTE_VIEWER_SSH_CONNECTION}'
    fi
    if [[ -n "\${OCC_CODEX_LAUNCH_PREFLIGHT:-}" && -x "\${OCC_CODEX_LAUNCH_PREFLIGHT}" ]]; then
      "\${OCC_CODEX_LAUNCH_PREFLIGHT}" agent hooks prepare-codex >/dev/null 2>&1 || :
    fi
    for __occ_codex_arg in "$@"; do
      case "$__occ_codex_arg" in
        --no-daemon) __occ_codex_isolate=0 ;;
        ${CODEX_SHARED_SERVER_ARGS.join('|')}|--remote=*) __occ_codex_isolate=0 __occ_codex_identity=0 ;;
      esac
    done
    if [[ "$__occ_codex_identity" != 0 ]]; then
${CODEX_COMMAND_IDENTITY_ENV_KEYS.map((key) => `      [[ -z "\${${key}:-}" || "\${${key}}" == *"'"* ]] || set -- -c "${identitySetArg(key, `\${${key}}`)}" "$@"`).join('\n')}
    fi
    # Why probe every launch: a cached answer goes stale across an upgrade, and 0.155 and older exit 2 on the flag.
    if [[ "$__occ_codex_isolate" != 0 ]]; then
      case "$(command codex --help 2>/dev/null </dev/null)" in *--no-daemon*) set -- --no-daemon "$@" ;; esac
    fi
    command codex "$@"
  }
fi
unset __occ_codex_binary
`
}

export function getFishCodexShellLaunchPreflight(): string {
  return `# Why captured: an unquoted (type -t codex) expands to zero words when codex is
# absent, leaving "test = file" — fish then errors instead of failing closed.
# Quoting in place is not the fix; fish never substitutes inside double quotes.
set -l __occ_codex_type (type -t codex 2>/dev/null)
if test "$__occ_codex_type" = file
  function codex
    if test -x "$OCC_CODEX_LAUNCH_PREFLIGHT"
      command "$OCC_CODEX_LAUNCH_PREFLIGHT" agent hooks prepare-codex >/dev/null 2>&1; or true
    end
    if test "$OCC_CODEX_ISOLATE" != 0; and not string match -qr -- '${CODEX_SHARED_SERVER_ARG_PATTERN}' $argv
${CODEX_COMMAND_IDENTITY_ENV_KEYS.map((key) => `      test -n "$${key}"; and not string match -q -- "*'*" "$${key}"; and set argv -c "${identitySetArg(key, `$${key}`)}" $argv`).join('\n')}
    end
    if test "$OCC_CODEX_ISOLATE" != 0; and not string match -qr -- '${CODEX_NO_DAEMON_SKIP_ARG_PATTERN}' $argv; and command codex --help 2>/dev/null </dev/null | string match -q -- '*--no-daemon*'
      set argv --no-daemon $argv
    end
    if test "$${REMOTE_VIEWER_CLIPBOARD_ENV}" = 1; and not set -q SSH_CONNECTION; and not set -q SSH_TTY
      set -lx SSH_CONNECTION '${CODEX_REMOTE_VIEWER_SSH_CONNECTION}'
      command codex $argv
    else
      command codex $argv
    end
  end
end
set -e __occ_codex_type`
}

// Keep the identity loop compact to share PowerShell’s command-line budget with startup commands.
export function getPowerShellCodexShellLaunchPreflight(): string {
  return `$occCodexCommand = Get-Command codex -ErrorAction SilentlyContinue | Select-Object -First 1
if ($occCodexCommand -and
    $occCodexCommand.CommandType -in @("Application", "ExternalScript")) {
    function Global:codex {
        $occCodexExecutable = Get-Command codex -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $occCodexExecutable) {
            Write-Error "codex executable not found"
            $global:LASTEXITCODE = 127
            return
        }
        $occCodexFlags = @()
        # Why try/catch: under the user's $ErrorActionPreference = 'Stop', a failing prep or probe must not abort the launch.
        if ($env:OCC_CODEX_LAUNCH_PREFLIGHT) {
            try {
                & $env:OCC_CODEX_LAUNCH_PREFLIGHT agent hooks prepare-codex *> $null
            } catch {
            }
        }
        if ($env:OCC_CODEX_ISOLATE -ne '0' -and -not (@($args) -cmatch '${CODEX_NO_DAEMON_SKIP_ARG_PATTERN}')) {
            try {
                if ((& $occCodexExecutable.Source --help 2>$null) -match '--no-daemon') {
                    $occCodexFlags = @('--no-daemon')
                }
            } catch {
            }
        }
        $occCodexIdentity = @()
        if ($env:OCC_CODEX_ISOLATE -ne '0' -and -not (@($args) -cmatch '${CODEX_SHARED_SERVER_ARG_PATTERN}')) {
            foreach ($k in ${CODEX_COMMAND_IDENTITY_ENV_KEYS.map((key) => `'${key}'`).join(',')}) { $v = [Environment]::GetEnvironmentVariable($k); if ($v -and -not $v.Contains("'")) { $occCodexIdentity += '-c', "${identitySetArg('$k', '$v')}" } }
        }
        $occCodexArgs = @(__OCCEscapeNativeArgs $occCodexExecutable.Source (@($occCodexIdentity) + @($args)))
        $occCodexRemoteClipboard = $env:${REMOTE_VIEWER_CLIPBOARD_ENV} -eq '1' -and -not (Test-Path Env:SSH_CONNECTION) -and -not (Test-Path Env:SSH_TTY)
        if ($occCodexRemoteClipboard) { $env:SSH_CONNECTION = '${CODEX_REMOTE_VIEWER_SSH_CONNECTION}' }
        # Why: a native command inside a function never sees the function's pipeline input on its own.
        try {
            if ($MyInvocation.ExpectingInput) {
                $input | & $occCodexExecutable.Source @occCodexFlags @occCodexArgs
            } else {
                & $occCodexExecutable.Source @occCodexFlags @occCodexArgs
            }
        } finally {
            if ($occCodexRemoteClipboard) { Remove-Item Env:SSH_CONNECTION }
        }
        $global:LASTEXITCODE = $LASTEXITCODE
    }
}
Remove-Variable occCodexCommand -ErrorAction SilentlyContinue`
}
