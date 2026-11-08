// Emitted rem lines must contain no percent signs: cmd expands them, even in comments inside blocks.
// Keep templates ASCII-only: multibyte comments broke cmd's byte-position tracking on Windows 11.

const WIN32_PASSTHROUGH_WRAPPER = String.raw`@echo off
rem Why explicit: bare setlocal inherits the caller's delayed-expansion state, and a parent shell
rem started with /V:ON made every PATH entry undergo ! expansion inside the loops below. A literal
rem !CD! entry then became the current directory and a planted git.cmd ran (exit 66), and a
rem legitimate directory whose name contains ! stopped resolving (exit 127). Both proven on
rem Windows 11; both disappear when the wrapper pins its own state.
setlocal DisableDelayedExpansion
set "occ_real=%OCC_REAL___OCC_UPPER_COMMAND__%"
set "occ_wrapper_dir=%~dp0"
set "occ_legacy_wrapper_dir=%OCC_ATTRIBUTION_SHIM_DIR%"
set "occ_clean_path="
rem Why: holds a single separator so the trailing-separator tests below need neither a literal
rem backslash before a quote (which breaks cmd parsing) nor a sentinel character (which would
rem corrupt any path containing it). Comparisons append a dot so the separator is never
rem adjacent to a closing quote, which would break the parser exactly as a literal would.
set "occ_sep=\"
rem Why a subroutine, not an "if defined ... " one-liner: cmd expands a whole line before it
rem evaluates the condition, so the substring syntax below still runs against an unset variable
rem and leaves the line mangled. A CALL body is only parsed once it is reached.
rem Why here: the value cannot change mid-run, so normalize once rather than per PATH entry.
set "occ_legacy_norm="
if defined occ_legacy_wrapper_dir call :occ_normalize_legacy_dir
rem Why: an empty PATH leaves the substitution below with an unbalanced quote, which
rem desynchronizes cmd parsing for the rest of the file. Skip the line entirely instead.
if not defined PATH goto :occ_path_walked
rem Why the variable: CALL re-expands its own command line, so a PATH entry naming the current
rem directory through a percent expression would become that directory before the rooted check
rem below ever saw it, and the cwd would then be searched for __OCC_COMMAND__. Proven on
rem Windows 11. The expression is spelled out only in the TypeScript comment above: cmd expands
rem percent signs inside rem, so writing one here would substitute a path into the comment.
for %%P in ("%PATH:;=" "%") do (
  set "occ_entry=%%~P"
  call :occ_append_path
)
:occ_path_walked
set "PATH=%occ_clean_path%"
set "OCC_ENABLE_GIT_ATTRIBUTION="
set "OCC_GIT_COMMIT_TRAILER="
set "OCC_GH_PR_FOOTER="
set "OCC_GH_ISSUE_FOOTER="
set "OCC_ATTRIBUTION_SHIM_DIR="
set "OCC_ATTRIBUTION_BYPASS="
set "OCC_REAL_GIT="
set "OCC_REAL_GH="
if defined occ_real for %%G in ("%occ_real%") do if /I "%%~dpG"=="%~dp0" set "occ_real="
rem Why: a captured path may be relative, and both "if exist" and the invocation resolve it
rem against the current directory, so an inherited .\__OCC_COMMAND__.exe would run from the repo.
set "occ_probe=%occ_real%"
if defined occ_real call :occ_check_rooted
if defined occ_real if not defined occ_rooted set "occ_real="
rem Why: clear a captured path that no longer exists, or the PATH walk below is skipped.
if defined occ_real if not exist "%occ_real%" set "occ_real="
if defined occ_real goto run
rem Why: an unqualified Windows command lookup searches the current directory before PATH, so a
rem repository-local __OCC_COMMAND__.exe would win. Walk the cleaned PATH ourselves instead.
if not defined occ_clean_path goto :occ_candidates_walked
for %%P in ("%occ_clean_path:;=" "%") do (
  set "occ_entry=%%~P"
  call :occ_try_candidate
)
:occ_candidates_walked
if not defined occ_real (
  echo OCC compatibility wrapper could not locate __OCC_COMMAND__ on PATH. 1>&2
  exit /b 127
)
:run
"%occ_real%" %*
exit /b %ERRORLEVEL%

:occ_normalize_legacy_dir
rem Why the rooted test first: full-path expansion resolves a relative value against the current
rem directory, so a
rem relative OCC_ATTRIBUTION_SHIM_DIR would let the cwd decide which PATH entry counts as the
rem legacy directory and get a legitimate one skipped. Leaving the normalized value unset makes
rem the reject subroutine below a no-op, which is the safe outcome.
set "occ_probe=%occ_legacy_wrapper_dir%"
call :occ_check_rooted
if not defined occ_rooted exit /b
for %%G in ("%occ_legacy_wrapper_dir%") do set "occ_legacy_norm=%%~fG"
rem Why: full-path expansion preserves a trailing separator; normalize before comparing.
if "%occ_legacy_norm:~-1%."=="%occ_sep%." set "occ_legacy_norm=%occ_legacy_norm:~0,-1%"
exit /b

:occ_check_rooted
rem Why: tested in pure batch on purpose. An external tool invoked here would itself be resolved
rem from the current directory, reintroducing the very hijack this guard exists to prevent.
rem Why occ_probe rather than an argument: see the CALL re-expansion note above.
set "occ_rooted="
rem Why: an unset probe would leave the substring syntax below unexpanded and mangle the line.
if not defined occ_probe exit /b
if "%occ_probe:~0,2%"=="\\" set "occ_rooted=1"
if "%occ_probe:~1,2%"==":\" set "occ_rooted=1"
if "%occ_probe:~1,2%"==":/" set "occ_rooted=1"
exit /b

:occ_try_candidate
if defined occ_real exit /b
if not defined occ_entry exit /b
rem Why: a relative entry resolves against the current directory, same exposure as an empty one.
set "occ_probe=%occ_entry%"
call :occ_check_rooted
if not defined occ_rooted exit /b
for %%G in ("%occ_entry%") do set "occ_candidate_dir=%%~fG"
rem Why: full-path expansion preserves a trailing separator, so without normalizing, the
rem self-exclusion below misses a wrapper-dir entry spelled with one and the wrapper resolves
rem to itself, looping forever.
if "%occ_candidate_dir:~-1%."=="%occ_sep%." set "occ_candidate_dir=%occ_candidate_dir:~0,-1%"
rem Why: the script-dir operator is rebound to this label inside CALL, so compare against the
rem cached wrapper dir captured at top level.
if /I "%occ_candidate_dir%\"=="%occ_wrapper_dir%" exit /b
if exist "%occ_candidate_dir%\__OCC_COMMAND__.exe" set "occ_real=%occ_candidate_dir%\__OCC_COMMAND__.exe"
if not defined occ_real if exist "%occ_candidate_dir%\__OCC_COMMAND__.cmd" set "occ_real=%occ_candidate_dir%\__OCC_COMMAND__.cmd"
if not defined occ_real if exist "%occ_candidate_dir%\__OCC_COMMAND__.bat" set "occ_real=%occ_candidate_dir%\__OCC_COMMAND__.bat"
exit /b

:occ_append_path
if not defined occ_entry exit /b
rem Why: the exported PATH is inherited by the real git and anything it spawns, so a relative
rem entry left here lets the current directory select those tools instead.
set "occ_probe=%occ_entry%"
call :occ_check_rooted
if not defined occ_rooted exit /b
for %%G in ("%occ_entry%") do set "occ_path_entry_dir=%%~fG"
rem Why: full-path expansion preserves a trailing separator; normalize before comparing.
if "%occ_path_entry_dir:~-1%."=="%occ_sep%." set "occ_path_entry_dir=%occ_path_entry_dir:~0,-1%"
set "occ_path_entry_dir=%occ_path_entry_dir%\"
if /I "%occ_path_entry_dir%"=="%occ_wrapper_dir%" exit /b
set "occ_skip_entry="
if defined occ_legacy_wrapper_dir call :occ_reject_legacy_dir
if defined occ_skip_entry exit /b
if defined occ_clean_path (set "occ_clean_path=%occ_clean_path%;%occ_entry%") else set "occ_clean_path=%occ_entry%"
exit /b

:occ_reject_legacy_dir
rem Why: an unrooted legacy dir leaves this unset, and comparing against a bare separator could
rem only ever misfire.
if not defined occ_legacy_norm exit /b
if /I "%occ_path_entry_dir%"=="%occ_legacy_norm%\" set "occ_skip_entry=1"
exit /b
`

const POWERSHELL_PASSTHROUGH_WRAPPER = String.raw`$ErrorActionPreference = 'Stop'
$commandName = '__OCC_COMMAND__'
$realCommand = [Environment]::GetEnvironmentVariable('OCC_REAL___OCC_UPPER_COMMAND__')
$wrapperDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$legacyWrapperDir = $env:OCC_ATTRIBUTION_SHIM_DIR
# Why both separators: the rooted-path test below accepts forward slashes, so a directory
# spelled with a trailing / would miss this lexical exclusion and the wrapper could recurse.
$wrapperDirs = @($wrapperDir, $legacyWrapperDir) | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\', '/') }
$env:PATH = (($env:PATH -split ';') | Where-Object {
  $pathEntry = $_
  # Why: the exported PATH is inherited by the real command and anything it spawns.
  $pathEntry -and ($pathEntry -match '^([A-Za-z]:[\\/]|\\\\)') -and -not ($wrapperDirs | Where-Object {
    [string]::Equals($_, $pathEntry.TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase)
  })
}) -join ';'
'OCC_ENABLE_GIT_ATTRIBUTION', 'OCC_GIT_COMMIT_TRAILER', 'OCC_GH_PR_FOOTER', 'OCC_GH_ISSUE_FOOTER', 'OCC_ATTRIBUTION_SHIM_DIR', 'OCC_REAL_GIT', 'OCC_REAL_GH', 'OCC_ATTRIBUTION_BYPASS' | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
# Why: a captured value may be relative, and Test-Path plus invocation resolve it against the cwd.
if ($realCommand -and $realCommand -notmatch '^([A-Za-z]:[\\/]|\\\\)') { $realCommand = $null }
if ($realCommand) {
  try {
    $capturedDir = Split-Path -Parent ([IO.Path]::GetFullPath($realCommand))
    if ([string]::Equals($capturedDir.TrimEnd('\', '/'), $wrapperDir.TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase)) {
      $realCommand = $null
    }
  } catch {
    $realCommand = $null
  }
}
if (-not $realCommand -or -not (Test-Path -LiteralPath $realCommand)) {
  # Why: resolve only against the cleaned PATH directories. Ambient lookup could pick up a
  # repository-local git.exe/gh.exe from the current directory.
  $realCommand = $null
  foreach ($dir in ($env:PATH -split ';')) {
    if (-not $dir) { continue }
    # Why: a relative entry resolves against the current directory, same exposure as an empty one.
    # IsPathRooted is not enough: it accepts drive-relative 'C:foo', which resolves against the
    # current directory on that drive. IsPathFullyQualified is absent on Windows PowerShell 5.1,
    # so match the same prefixes the cmd wrapper accepts.
    if ($dir -notmatch '^([A-Za-z]:[\\/]|\\\\)') { continue }
    if ($wrapperDirs | Where-Object { [string]::Equals($_, $dir.TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase) }) { continue }
    foreach ($ext in @('.exe', '.cmd', '.bat')) {
      $candidate = Join-Path $dir "$commandName$ext"
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { $realCommand = $candidate; break }
    }
    if ($realCommand) { break }
  }
}
if (-not $realCommand) {
  [Console]::Error.WriteLine("OCC compatibility wrapper could not locate $commandName on PATH.")
  exit 127
}
& $realCommand @args
exit $LASTEXITCODE
`

function renderWindowsWrapper(template: string, command: string, upperCommand: string): string {
  return template
    .replaceAll('__OCC_UPPER_COMMAND__', upperCommand)
    .replaceAll('__OCC_COMMAND__', command)
}

// cmd label seeks failed in longer LF-only wrappers; emit CRLF.
function toCrlf(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')
}

export function renderLegacyTerminalWindowsCmdTombstone(command: 'git' | 'gh'): string {
  return toCrlf(renderWindowsWrapper(WIN32_PASSTHROUGH_WRAPPER, command, command.toUpperCase()))
}

export function renderLegacyTerminalWindowsPowerShellTombstone(command: 'git' | 'gh'): string {
  return toCrlf(
    renderWindowsWrapper(POWERSHELL_PASSTHROUGH_WRAPPER, command, command.toUpperCase())
  )
}
