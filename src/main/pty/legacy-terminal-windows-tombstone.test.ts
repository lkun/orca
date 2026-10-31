import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolvePosixTombstoneInterpreter } from './legacy-terminal-posix-tombstone'
import {
  __resetLegacyTerminalShimNeutralizationForTests,
  neutralizeLegacyTerminalShimDir
} from './legacy-terminal-shim-dir'

// Missing indexOf operands return -1 and can falsely satisfy ordering.
function expectOrdered(text: string, first: string, second: string): void {
  expect(text, `missing: ${first}`).toContain(first)
  expect(text, `missing: ${second}`).toContain(second)
  expect(text.indexOf(first)).toBeLessThan(text.indexOf(second))
}

describe('legacy terminal Windows tombstone text', () => {
  const tempRoots: string[] = []

  const makeUserDataDir = (): string => {
    const userData = mkdtempSync(join(tmpdir(), 'occ-legacy-shim-win-'))
    tempRoots.push(userData)
    return userData
  }

  beforeEach(() => {
    __resetLegacyTerminalShimNeutralizationForTests()
  })

  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects stale Windows real-command paths inside the wrapper directory', () => {
    const userData = makeUserDataDir()
    const win32Dir = join(userData, 'occ-terminal-attribution', 'win32')
    mkdirSync(win32Dir, { recursive: true })

    neutralizeLegacyTerminalShimDir(userData)

    const cmd = readFileSync(join(win32Dir, 'git.cmd'), 'utf8')
    expect(cmd).toContain(
      'if defined occ_real for %%G in ("%occ_real%") do if /I "%%~dpG"=="%~dp0" set "occ_real="'
    )
    // A stale captured path must fall back instead of invoking a missing binary.
    expect(cmd).toContain('if defined occ_real if not exist "%occ_real%" set "occ_real="')
    expectOrdered(cmd, 'if not exist "%occ_real%"', ':occ_try_candidate')
    const powershell = readFileSync(join(win32Dir, 'git-wrapper.ps1'), 'utf8')
    expect(powershell).toContain('[StringComparison]::OrdinalIgnoreCase')
    expect(powershell).toContain('$realCommand = $null')
    expectOrdered(
      powershell,
      '[StringComparison]::OrdinalIgnoreCase',
      'Test-Path -LiteralPath $realCommand'
    )
  })

  it('emits no percent expression inside a cmd rem comment', () => {
    // cmd expands variables even in rem; separators behave differently inside blocks.
    const userData = makeUserDataDir()
    const win32Dir = join(userData, 'occ-terminal-attribution', 'win32')
    mkdirSync(win32Dir, { recursive: true })

    neutralizeLegacyTerminalShimDir(userData)

    for (const command of ['git', 'gh'] as const) {
      const offending = readFileSync(join(win32Dir, `${command}.cmd`), 'utf8')
        .split('\r\n')
        .filter((line) => /^\s*rem\b/i.test(line) && line.includes('%'))
      expect(offending, `rem comments with percent expressions: ${offending.join(' | ')}`).toEqual(
        []
      )
    }
  })

  it('keeps the Windows wrappers ASCII-only', () => {
    // Multibyte comments shifted cmd byte positions and broke following lines on Windows 11.
    const userData = makeUserDataDir()
    const win32Dir = join(userData, 'occ-terminal-attribution', 'win32')
    mkdirSync(win32Dir, { recursive: true })

    neutralizeLegacyTerminalShimDir(userData)

    for (const name of ['git.cmd', 'gh.cmd', 'git-wrapper.ps1', 'gh-wrapper.ps1']) {
      const contents = readFileSync(join(win32Dir, name), 'utf8')
      const offending = [...contents].find((character) => character.charCodeAt(0) > 0x7f)
      expect(offending, `${name} contains non-ASCII ${JSON.stringify(offending)}`).toBeUndefined()
      expect(Buffer.byteLength(contents, 'utf8')).toBe(contents.length)
    }
  })

  it('resolves Windows fallbacks against PATH only, never the current directory', () => {
    // where.exe searches cwd first and could execute repository-local git/gh (STA-4169).
    const userData = makeUserDataDir()
    const win32Dir = join(userData, 'occ-terminal-attribution', 'win32')
    mkdirSync(win32Dir, { recursive: true })

    neutralizeLegacyTerminalShimDir(userData)

    for (const command of ['git', 'gh'] as const) {
      const cmd = readFileSync(join(win32Dir, `${command}.cmd`), 'utf8')
      expect(cmd).not.toContain('where.exe')
      expect(cmd).toContain('for %%P in ("%occ_clean_path:;=" "%") do (')
      expect(cmd).toContain(`if exist "%occ_candidate_dir%\\${command}.exe"`)
      // Normalize trailing separators to avoid self-exec; a variable avoids cmd's literal-backslash parser trap.
      expect(cmd).toContain('set "occ_sep=\\"')
      // Inherited /V:ON expands ! in PATH; measured cases executed cwd-local git or lost legitimate entries.
      expect(cmd).toContain('setlocal DisableDelayedExpansion')
      expect(cmd).not.toContain('\r\nsetlocal\r\n')
      // Relative captured commands resolve from cwd and must be rejected.
      expect(cmd).toContain('if defined occ_real call :occ_check_rooted')
      expect(cmd).toContain('if defined occ_real if not defined occ_rooted set "occ_real="')
      // Exported PATH reaches child tools; pin the exact subroutine because matching earlier call sites hid its missing guard.
      expect(cmd).toContain(':occ_append_path\r\nif not defined occ_entry exit /b\r\n')
      expect(cmd).toContain(
        'set "occ_probe=%occ_entry%"\r\ncall :occ_check_rooted\r\nif not defined occ_rooted exit /b\r\nfor %%G in ("%occ_entry%") do set "occ_path_entry_dir=%%~fG"'
      )
      // CALL re-expands path arguments: literal percent variables could become cwd and execute planted git. Pass data through variables.
      expect(cmd).not.toContain('call :occ_check_rooted "')
      expect(cmd).not.toContain('call :occ_try_candidate "')
      expect(cmd).not.toContain('call :occ_append_path "')
      expect(cmd).not.toContain('%~1')
      expect(cmd).toContain('set "occ_probe=%occ_entry%"\r\ncall :occ_check_rooted\r\n')
      // Define the separator before any normalization; otherwise stripping silently no-ops.
      expectOrdered(cmd, 'set "occ_sep=', 'if "%occ_legacy_norm:~-1%."')
      // Compare dot-suffixed values to avoid expanding the separator into a literal-backslash parser trap.
      expect(cmd).not.toContain('=="%occ_sep%"')
      // Pin rejection too; accept-only assertions stayed green when the cwd-hijack guard was removed.
      expectOrdered(
        cmd,
        'call :occ_check_rooted\r\nif not defined occ_rooted exit /b',
        'for %%G in ("%occ_entry%") do set "occ_candidate_dir='
      )
      expect(cmd).toContain('if not defined occ_rooted exit /b')
      expect(cmd).toContain('if "%occ_candidate_dir:~-1%."=="%occ_sep%."')
      expect(cmd).not.toContain(':\\#=#%')
      // CALL rebinds %~dp0; self-exclusion must use the cached wrapper directory.
      expect(cmd).toContain('if /I "%occ_candidate_dir%\\"=="%occ_wrapper_dir%" exit /b')
      // External tools in the rooted-path check would reintroduce cwd lookup.
      expect(cmd).not.toContain('findstr')
      expect(cmd).toContain('if "%occ_probe:~1,2%"==":\\" set "occ_rooted=1"')
      expect(cmd).toContain('if "%occ_probe:~0,2%"=="\\\\" set "occ_rooted=1"')
      // Both empty-element guards need pins; removing either otherwise left the suite green.
      expect(cmd).toContain('if not defined occ_entry exit /b')

      const powershell = readFileSync(join(win32Dir, `${command}-wrapper.ps1`), 'utf8')
      expect(powershell).not.toContain('Get-Command')
      expect(powershell).toContain("($env:PATH -split ';')")
      // IsPathRooted accepts drive-relative C:foo; require an absolute prefix.
      expect(powershell).not.toContain('[IO.Path]::IsPathRooted(')
      expect(powershell).toContain("$pathEntry -match '^([A-Za-z]:[\\\\/]|\\\\\\\\)'")
      expect(powershell).toContain("$realCommand -notmatch '^([A-Za-z]:[\\\\/]|\\\\\\\\)'")
      // A shorter prefix would also accept drive-relative C:foo.
      expect(powershell).toContain("-notmatch '^([A-Za-z]:[\\\\/]|\\\\\\\\)'")
      // Mutation showed each trailing-separator normalization could disappear without other failures.
      expect(powershell).toContain("ForEach-Object { $_.TrimEnd('\\', '/') }")
      expect(powershell).toContain("$pathEntry.TrimEnd('\\', '/')")
      expect(powershell).toContain("$dir.TrimEnd('\\', '/')")
      expect(powershell).toContain("$capturedDir.TrimEnd('\\', '/')")
      expect(powershell).toContain(
        "$dir.TrimEnd('\\', '/'), [StringComparison]::OrdinalIgnoreCase) }) { continue }"
      )
      // Both separators are accepted in rooted paths and must be normalized for self-exclusion.
      expect(powershell).not.toContain("TrimEnd('\\')")
      expect(cmd).toContain('if "%occ_probe:~1,2%"==":/" set "occ_rooted=1"')
      expect(cmd).toContain('if "%occ_legacy_norm:~-1%."=="%occ_sep%."')
      // cmd expands whole lines before if defined; defer unset-variable substring operations into a CALL body.
      expect(cmd).toContain('if defined occ_legacy_wrapper_dir call :occ_normalize_legacy_dir')
      expect(cmd).not.toContain('if defined occ_legacy_wrapper_dir for ')
      expect(powershell).toContain('if (-not $dir) { continue }')
      expect(powershell).toContain('Test-Path -LiteralPath $candidate -PathType Leaf')
    }
  })

  it('emits Windows wrappers with CRLF line endings', () => {
    // cmd label lookup failed for longer LF-only wrappers on Windows; require CRLF.
    const userData = makeUserDataDir()
    const win32Dir = join(userData, 'occ-terminal-attribution', 'win32')
    mkdirSync(win32Dir, { recursive: true })

    neutralizeLegacyTerminalShimDir(userData)

    for (const file of ['git.cmd', 'gh.cmd', 'git-wrapper.ps1', 'gh-wrapper.ps1']) {
      const body = readFileSync(join(win32Dir, file), 'utf8')
      expect(body, file).toContain('\r\n')
      expect(body.replaceAll('\r\n', ''), file).not.toContain('\n')
    }
  })

  it('guards both cmd PATH walks so an empty variable cannot break parsing', () => {
    // Expanding an empty PATH into quoted elements leaves unbalanced quotes and breaks cmd parsing.
    const userData = makeUserDataDir()
    const win32Dir = join(userData, 'occ-terminal-attribution', 'win32')
    mkdirSync(win32Dir, { recursive: true })

    neutralizeLegacyTerminalShimDir(userData)

    for (const command of ['git', 'gh'] as const) {
      const cmd = readFileSync(join(win32Dir, `${command}.cmd`), 'utf8')
      expect(cmd).toContain('if not defined PATH goto :occ_path_walked')
      expect(cmd).toContain('if not defined occ_clean_path goto :occ_candidates_walked')
      for (const [guard, loop] of [
        ['if not defined PATH goto :occ_path_walked', 'for %%P in ("%PATH:;='],
        [
          'if not defined occ_clean_path goto :occ_candidates_walked',
          'for %%P in ("%occ_clean_path:;='
        ]
      ] as const) {
        expectOrdered(cmd, guard, loop)
      }
    }
  })

  it('never bakes an ambient interpreter lookup on Windows', () => {
    // Windows cannot verify guest paths; both Git Bash and WSL map /bin/bash without ambient lookup.
    expect(resolvePosixTombstoneInterpreter(undefined, [], 'win32')).toBe('/bin/bash')
    expect(resolvePosixTombstoneInterpreter('C:\\Git\\bin;C:\\Windows', [], 'win32')).toBe(
      '/bin/bash'
    )
  })
})
