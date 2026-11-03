import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess, runProcessSync, spawnProcess } from './run-process'
import { resolveSpawn } from './spawn-resolution'
import {
  WSL_DISTRO_ALLOWLIST_ENV,
  WSL_DISTRO_NOT_ALLOWLISTED_CODE,
  assertWslDistroAllowed,
  parseWslDistroAllowlist
} from './wsl-distro-allowlist'

const WSL = 'C:\\Windows\\System32\\wsl.exe'

function refusal(program: string, args: readonly string[]): unknown {
  try {
    assertWslDistroAllowed(program, args)
    return null
  } catch (error) {
    return error
  }
}

describe('internal WSL distro allowlist', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('allowlisted: lets every distro-targeting form through, case-insensitively', () => {
    vi.stubEnv(WSL_DISTRO_ALLOWLIST_ENV, 'occ-test-a, OCC-Test-B')
    for (const args of [
      ['-d', 'occ-test-a', '--exec', 'sh', '-c', 'echo -d Ubuntu'],
      ['--distribution', 'OCC-TEST-B', '-u', 'root', '--cd', '~', '--exec', 'id'],
      ['-t', 'occ-test-a'],
      ['--terminate', 'occ-test-b'],
      ['--unregister', 'occ-test-a']
    ]) {
      expect(refusal(WSL, args), args.join(' ')).toBeNull()
    }
    expect(refusal('wsl', ['-d', 'occ-test-a'])).toBeNull()
  })

  it('not allowlisted: refuses other distros, no-distro forms, ids and --shutdown', () => {
    vi.stubEnv(WSL_DISTRO_ALLOWLIST_ENV, 'occ-test-a')
    for (const args of [
      ['-d', 'Ubuntu', '--exec', 'sh'],
      ['-d', 'occ-test-a', '-d', 'Ubuntu'],
      ['-t', 'Ubuntu'],
      ['--unregister', 'Ubuntu'],
      ['--distribution-id', '{11111111-2222-3333-4444-555555555555}'],
      ['--exec', 'sh'],
      ['ls'],
      ['-l', '-d'],
      ['--shutdown'],
      ['-d', 'occ-test-a', '--shutdown']
    ]) {
      expect(refusal(WSL, args), args.join(' ')).toMatchObject({
        code: WSL_DISTRO_NOT_ALLOWLISTED_CODE
      })
    }
    // Matched by basename, case-insensitively.
    expect(refusal('C:\\WINDOWS\\SYSTEM32\\WSL.EXE', ['-d', 'Ubuntu'])).not.toBeNull()
    expect(refusal('/usr/bin/wsl', ['-d', 'Ubuntu'])).not.toBeNull()
    expect(refusal('wslconfig.exe', ['/l'])).toBeNull()
    expect(refusal('git', ['-d', 'Ubuntu'])).toBeNull()
  })

  it('stops at the first positional argument, which wsl.exe runs in the default distro', () => {
    vi.stubEnv(WSL_DISTRO_ALLOWLIST_ENV, 'occ-test-a')
    for (const args of [
      ['ls', '-d', 'occ-test-a'],
      ['-u', 'root', 'ls', '-d', 'occ-test-a'],
      ['--cd', '/tmp', 'sh', '-c', 'true', '-d', 'occ-test-a']
    ]) {
      expect(refusal(WSL, args), args.join(' ')).toMatchObject({
        code: WSL_DISTRO_NOT_ALLOWLISTED_CODE
      })
    }
    expect(refusal(WSL, ['-d', 'occ-test-a', 'ls', '-d', 'Ubuntu'])).toBeNull()
  })

  it('malformed: fails closed for every distro and logs once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const value of ['', ' ', 'occ-test-a,', 'occ test', 'a;b']) {
      expect(parseWslDistroAllowlist(value), JSON.stringify(value)).toBeNull()
    }
    vi.stubEnv(WSL_DISTRO_ALLOWLIST_ENV, 'occ-test-a,,')
    expect(refusal(WSL, ['-d', 'occ-test-a'])).toMatchObject({
      code: WSL_DISTRO_NOT_ALLOWLISTED_CODE
    })
    expect(refusal(WSL, ['-d', 'Ubuntu'])).not.toBeNull()
    expect(refusal(WSL, ['-l', '-v'])).toBeNull()
    vi.stubEnv(WSL_DISTRO_ALLOWLIST_ENV, '')
    expect(refusal(WSL, ['-d', 'occ-test-a'])).not.toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('refuses before any child starts, through every process-host entry point', async () => {
    vi.stubEnv(WSL_DISTRO_ALLOWLIST_ENV, 'occ-test-a')
    const spec = { program: WSL, args: ['-d', 'Ubuntu', '--exec', 'true'] }
    expect(() => resolveSpawn(spec, 'win32')).toThrow(/not on the allowlist/)
    expect(() => spawnProcess(spec)).toThrow(/not on the allowlist/)
    expect(() => runProcessSync(spec)).toThrow(/not on the allowlist/)
    // runProcess rejects, so async callers' existing failure, retry and fallback paths take over.
    await expect(runProcess(spec)).rejects.toMatchObject({ code: WSL_DISTRO_NOT_ALLOWLISTED_CODE })
  })
})
