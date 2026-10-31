// D7: switch Electron serve ↔ occd serve on one profile without replacing surviving daemon terminals; each host must refuse the other’s profile lock.
// Build pnpm build:occd, then run electron-headless with OCC_E2E_OCCD_SERVE=1 OCC_BACKGROUND_LAUNCH=1.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runProcess } from '@occ/process-host'
import { getDaemonPidPath } from '../../src/main/daemon/daemon-spawner'
import { readDaemonPidRecord } from '../../src/main/daemon/daemon-endpoint-incarnation'
import { resolveBundledOCCdRuntime } from '../../src/main/occd/occd-bundled-runtime'
import { OCCD_EXIT_CONFIGURATION } from '../../src/main/occd/occd-configuration-exit'
import {
  buildDaemonSessionClient,
  type DaemonSessionClientResult
} from '../../src/main/occd/occd-daemon-session-client-fixture'
import { expect, test } from './helpers/occ-app'
import { resolveElectronExecutable } from './helpers/daemon-generation-runtime-fixture'
import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from './helpers/headless-paired-runtime-host'
import { cleanupE2EDaemons } from './helpers/electron-process-shutdown'
import {
  cliServeProfile,
  isPidAlive,
  spawnUntilReady,
  startCliServe
} from './helpers/occ-serve-cli-host'

const RUN = process.env.OCC_E2E_OCCD_SERVE === '1'
const slotDir = path.resolve('out/occd')
const occdRuntime = RUN && existsSync(slotDir) ? resolveBundledOCCdRuntime(slotDir) : null
const SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE = 3

test.describe.configure({ mode: 'serial' })

let scratch = ''
let clientScript = ''

test.beforeAll(async () => {
  test.skip(!RUN, 'Set OCC_E2E_OCCD_SERVE=1 (and build out/occd) to run the serve mode switch.')
  expect(occdRuntime, 'pnpm build:occd must produce a packaged slot in out/occd').toBeTruthy()
  // Short root: macOS caps a unix socket path at 104 bytes, and the daemon's lives in userData.
  scratch = mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'occ-d7-'))
  clientScript = path.join(scratch, 'daemon-client.cjs')
  await buildDaemonSessionClient(clientScript)
})

test.afterAll(() => {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 })
  }
})

function daemonPid(userDataDir: string): number | null {
  return readDaemonPidRecord(getDaemonPidPath(path.join(userDataDir, 'daemon')))?.pid ?? null
}

/** A paired client's terminal, straight to the profile's daemon, under this runner's Node. */
async function terminal(
  host: HeadlessPairedRuntimeHost,
  op: 'create' | 'attach',
  marker: string
): Promise<DaemonSessionClientResult> {
  const result = await runProcess({
    program: process.execPath,
    args: [clientScript, op, path.join(host.userDataDir, 'daemon'), 'serve-d7', marker, scratch],
    env: host.env,
    timeoutMs: 30_000
  })
  expect(result.code, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')
}

type OCCdServe = { daemonPid: number; stop: () => Promise<void> }

/** `occ serve` on occd, as the T6-11 launcher runs it, on the host's own profile. */
async function startOCCdServe(
  host: Pick<HeadlessPairedRuntimeHost, 'env' | 'userDataDir'>
): Promise<OCCdServe> {
  const serve = await spawnUntilReady({
    label: 'occd serve',
    program: occdRuntime!,
    args: [path.join(slotDir, 'occd.js'), '--bind', '127.0.0.1', '--port', '0', '--json'],
    env: { ...host.env, OCC_USER_DATA: host.userDataDir },
    timeoutMs: 120_000,
    parseReady: (stdout) => {
      const newline = stdout.indexOf('\n')
      return newline === -1 ? null : stdout.slice(0, newline)
    }
  })
  try {
    const daemon = JSON.parse(serve.ready).health?.terminalDaemon
    expect(daemon?.state, serve.stderr()).toBe('live')
    // POSIX: SIGTERM is occd's graceful stop and leaves the daemon running by design.
    return { daemonPid: daemon.pid, stop: serve.stop }
  } catch (error) {
    // Why: the caller never gets stop(), and a leaked occd keeps the profile lock.
    await serve.stop()
    throw error
  }
}

// Why: an SSH-managed occd on this machine runs under ~/.occ, beside the desktop's own profile.
test("Electron serve starts beside a live daemon another profile's occd forked", async () => {
  const other = cliServeProfile(scratch)
  const occd = await startOCCdServe(other)
  try {
    const host = await launchHeadlessPairedRuntimeHost({
      pinnedServePort: true,
      userDataParent: scratch
    })
    try {
      expect(daemonPid(host.userDataDir)).not.toBe(occd.daemonPid)
    } finally {
      await host.dispose()
    }
  } finally {
    await occd.stop()
    await cleanupE2EDaemons(other.userDataDir)
  }
})

test('a terminal survives Electron serve → occd serve → Electron serve on one profile', async () => {
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    userDataParent: scratch
  })
  try {
    const created = await terminal(host, 'create', 'ELECTRON')
    expect(created).toMatchObject({ isReattach: false, output: true })
    const electronDaemon = daemonPid(host.userDataDir)
    expect(electronDaemon).toBeTruthy()

    await host.restartServeProcess({
      betweenProcesses: async () => {
        // Electron serve has quit; occd serve takes the same profile and adopts its daemon.
        const occd = await startOCCdServe(host)
        try {
          expect(occd.daemonPid).toBe(electronDaemon)
          expect(await terminal(host, 'attach', 'OCCD')).toEqual({
            pid: created.pid,
            isReattach: true,
            output: true
          })
        } finally {
          await occd.stop()
        }
      }
    })

    // Back on Electron serve: still the same daemon and the same live terminal.
    expect(daemonPid(host.userDataDir)).toBe(electronDaemon)
    expect(await terminal(host, 'attach', 'BACK')).toEqual({
      pid: created.pid,
      isReattach: true,
      output: true
    })
  } finally {
    await host.dispose()
  }
})

test("Electron serve adopts a terminal occd's daemon owns", async () => {
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    userDataParent: scratch
  })
  try {
    let created: DaemonSessionClientResult | null = null
    let occdDaemon: number | null = null
    await host.restartServeProcess({
      betweenProcesses: async () => {
        // Retire Electron's daemon so occd serve forks its own on the pinned Node.
        const previous = daemonPid(host.userDataDir)
        if (previous) {
          process.kill(previous, 'SIGKILL')
          await expect.poll(() => isPidAlive(previous), { timeout: 10_000 }).toBe(false)
        }
        const occd = await startOCCdServe(host)
        try {
          occdDaemon = occd.daemonPid
          expect(occdDaemon).not.toBe(previous)
          created = await terminal(host, 'create', 'OCCD')
          expect(created).toMatchObject({ isReattach: false, output: true })
        } finally {
          await occd.stop()
        }
      }
    })
    expect(daemonPid(host.userDataDir)).toBe(occdDaemon)
    expect(await terminal(host, 'attach', 'ELECTRON')).toEqual({
      pid: created!.pid,
      isReattach: true,
      output: true
    })
  } finally {
    await host.dispose()
  }
})

test('each serve host refuses a profile the other holds', async () => {
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    userDataParent: scratch
  })
  try {
    // Electron serve holds the profile: occd serve refuses with its configuration exit code.
    const refused = await runProcess({
      program: occdRuntime!,
      args: [path.join(slotDir, 'occd.js'), '--bind', '127.0.0.1', '--port', '0', '--json'],
      env: { ...host.env, OCC_USER_DATA: host.userDataDir },
      timeoutMs: 60_000
    })
    expect(refused.code).toBe(OCCD_EXIT_CONFIGURATION)
    expect(refused.stdout).toBe('')
    expect(refused.stderr).toContain('The OCC desktop app')

    await host.restartServeProcess({
      betweenProcesses: async () => {
        // occd serve holds it: an Electron launch on the same profile exits as a duplicate.
        const occd = await startOCCdServe(host)
        try {
          const electron = await runProcess({
            program: resolveElectronExecutable(process.cwd()),
            args: [...host.electronArgs, '--serve', '--serve-json', '--serve-port', '0'],
            env: host.env,
            timeoutMs: 90_000
          })
          expect(electron.code).toBe(SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE)
          expect(`${electron.stdout}${electron.stderr}`).toContain('Another occd')
        } finally {
          await occd.stop()
        }
      }
    })
  } finally {
    await host.dispose()
  }
})

/** Which host holds the profile: both take `occd.lock`, each under its own role. */
function profileLockRole(userDataDir: string): unknown {
  return JSON.parse(readFileSync(path.join(userDataDir, 'occd.lock'), 'utf8')).role
}

// Needs out/occd-template for this runner's target, as a packaged install carries.
test('`occ serve` runs on occd by default and on Electron with OCC_SERVE_RUNTIME=electron', async () => {
  const profile = cliServeProfile(scratch)
  try {
    const byDefault = await startCliServe(profile)
    try {
      expect(byDefault.stderr()).toContain('[serve] running on occd')
      expect(byDefault.readiness.health).toBeDefined()
      expect(profileLockRole(profile.userDataDir)).toBe('occd')
    } finally {
      await byDefault.stop()
    }

    // Electron serve publishes no build-health block yet, which is what tells the two apart.
    const electron = await startCliServe(profile, { OCC_SERVE_RUNTIME: 'electron' })
    try {
      expect(electron.stderr()).not.toContain('[serve] running on occd')
      expect(electron.readiness.health).toBeUndefined()
    } finally {
      await electron.stop()
    }
  } finally {
    await cleanupE2EDaemons(profile.userDataDir)
  }
})
