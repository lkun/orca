import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runWslProcess } from './wsl-runner'
import { invalidateWslGuestEnvironment } from './wsl-guest-environment'
import { runProcess } from '@occ/process-host'
import { resolveWslExecutablePath } from './wsl-executable-path'

/** Real distro/login/rc contract, gated on Windows and OCC_REAL_WSL_RUNNER_TEST because it mutates ~/.profile. Run: OCC_REAL_WSL_RUNNER_TEST=1 pnpm vitest run src/main/wsl/wsl-runner.wsl.test.ts */
const DISTRO = process.env.OCC_WSL_TEST_DISTRO ?? 'Ubuntu-24.04'
const enabled = process.platform === 'win32' && process.env.OCC_REAL_WSL_RUNNER_TEST === '1'
const describeOnWsl = enabled ? describe : describe.skip

const PROFILE = '/tmp/occ-wsl-runner-profile.bak'

async function guest(script: string): Promise<string> {
  const result = await runProcess({
    program: resolveWslExecutablePath(),
    args: ['-d', DISTRO, '--exec', 'sh', '-c', script],
    timeoutMs: 30_000
  })
  return result.stdout.trim()
}

describeOnWsl('runWslProcess against a real distro', () => {
  beforeAll(async () => {
    // Save the profile, then reproduce #14288 with a real blocking login.
    await guest(`cp -f "$HOME/.profile" ${PROFILE} 2>/dev/null || true`)
    await guest(`printf '\\nsleep 60\\n' >> "$HOME/.profile"`)
    invalidateWslGuestEnvironment(undefined, true)
  }, 120_000)

  afterAll(async () => {
    await guest(`cp -f ${PROFILE} "$HOME/.profile" 2>/dev/null || rm -f "$HOME/.profile"`)
    await guest(`rm -f ${PROFILE}`)
    invalidateWslGuestEnvironment(undefined, true)
  }, 120_000)

  it('probe lane survives a ~/.profile that blocks for a minute', async () => {
    // Probe failure must remain nonfatal and the call must finish within its budget despite the 60s profile block.
    const started = Date.now()
    const result = await runWslProcess({
      loginPath: 'preferred',
      distro: DISTRO,
      program: '/bin/echo',
      args: ['occ-probe-ok'],
      timeoutMs: 15_000
    })
    const elapsed = Date.now() - started
    expect(result.stdout.trim()).toContain('occ-probe-ok')
    expect(elapsed).toBeLessThan(20_000)
  }, 60_000)

  it('a script with quotes and $ arrives byte-identical', async () => {
    // Preserve $2 and embedded quotes; -- expansion/base64-eval wrappers broke both (#12964/#14292).
    const script = [
      `printf '%s\\n' "$1"`,
      `echo 'it'\\''s fine'`,
      `echo "x" | awk '{print $1}'`
    ].join('\n')
    const result = await runWslProcess({
      loginPath: 'preferred',
      distro: DISTRO,
      script,
      args: ['OCC_ARG'],
      timeoutMs: 30_000
    })
    expect(
      result.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    ).toEqual(['OCC_ARG', "it's fine", 'x'])
  }, 60_000)

  it('propagated env crosses the boundary via WSLENV', async () => {
    const result = await runWslProcess({
      loginPath: 'preferred',
      distro: DISTRO,
      script: 'printf %s "$OCC_WSLENV_PROBE"',
      env: { OCC_WSLENV_PROBE: 'crossed' },
      timeoutMs: 30_000
    })
    expect(result.stdout.trim()).toBe('crossed')
  }, 60_000)

  it('runs in the requested guest cwd', async () => {
    const result = await runWslProcess({
      loginPath: 'preferred',
      distro: DISTRO,
      program: '/bin/pwd',
      cwd: '/tmp',
      timeoutMs: 30_000
    })
    expect(result.stdout.trim()).toBe('/tmp')
  }, 60_000)
})
