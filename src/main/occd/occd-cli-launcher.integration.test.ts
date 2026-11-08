import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/test-runtime/environment/vitest-host-ports-setup'
import { runProcess, spawnProcess } from '@occ/process-host'
import { sealedChildEnv } from '../runtime/agent-session/environment/structured-session-child-env.test-support'
import { resolveBundledOCCdRuntime } from './occd-bundled-runtime'
import { OCCD_NODE_RUNTIME_MARKER_FILENAME } from '../../shared/occd-artifacts'
import { skipForMissingInputs } from './occd-node-slot-fixture'
import {
  killChildAndWait,
  killProfileDaemons,
  recordProfileDaemons,
  removeTestRoot
} from './occd-daemon-teardown-fixture'

const slotDir = resolve('out/occd')
const runtime = existsSync(join(slotDir, OCCD_NODE_RUNTIME_MARKER_FILENAME))
  ? resolveBundledOCCdRuntime(slotDir)
  : null
const skip = skipForMissingInputs('artifact', runtime ? [] : ['a Node occd slot in out/occd'])

it.skipIf(skip)(
  "an agent's CLI reaches its owning server while a person's selector is honoured",
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'occd-cli-'))
    const home = join(root, 'home')
    mkdirSync(home)
    const userData = join(root, 'state')
    mkdirSync(userData)
    writeFileSync(
      join(userData, 'occ-data.json'),
      JSON.stringify({ settings: { agentStatusHooksEnabled: false } })
    )
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      LOCALAPPDATA: home,
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
      PATH: process.platform === 'win32' ? process.env.PATH : '/usr/bin:/bin',
      TEMP: root,
      TMP: root,
      TMPDIR: root,
      CODEX_HOME: join(home, 'codex'),
      CLAUDE_CONFIG_DIR: join(home, 'claude'),
      OCC_USER_DATA: userData,
      OCC_BACKGROUND_LAUNCH: '1',
      OCC_DISABLE_MACOS_LOGIN_SHELL: '1'
    }
    const child = spawnProcess({
      program: runtime!,
      args: [
        join(slotDir, 'occd.js'),
        '--bind',
        '127.0.0.1',
        '--port',
        '0',
        '--no-pairing',
        '--json'
      ],
      env,
      timeoutMs: null
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    try {
      await new Promise<void>((ready, reject) => {
        let stdout = ''
        const timer = setTimeout(
          () => reject(new Error(`server readiness timed out: ${stderr.slice(-2000)}`)),
          120_000
        )
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
          if (stdout.includes('\n')) {
            clearTimeout(timer)
            ready()
          }
        })
        child.once('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`server exited ${String(code)}: ${stderr.slice(-2000)}`))
        })
      })
      const launcher = join(
        userData,
        'cli',
        'bin',
        process.platform === 'win32' ? 'occ.exe' : 'occ'
      )
      expect(existsSync(launcher)).toBe(true)
      installFakeAppEnvironment({
        getPath: () => userData,
        isPackaged: () => true,
        getCliLauncherPath: () => launcher
      })
      const childEnv = sealedChildEnv('claude_test-session', {
        PATH: env.PATH ?? '',
        OCC_ENVIRONMENT: 'stale-shell-selection',
        OCC_PAIRING_CODE: 'stale-pairing',
        OCC_REMOTE_PAIRING: 'stale-remote-pairing'
      })
      const result = await runProcess({
        program: childEnv.OCC_CLI_COMMAND!,
        args: ['status', '--json'],
        env: { ...env, ...childEnv },
        cwd: home,
        timeoutMs: 15_000
      })
      expect(result.code, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        result: {
          app: { running: true, pid: child.pid },
          runtime: { reachable: true, state: 'ready' }
        }
      })
      const skill = await runProcess({
        program: childEnv.OCC_CLI_COMMAND!,
        args: ['skills', 'get', 'orchestration'],
        env: { ...env, ...childEnv },
        timeoutMs: 15_000
      })
      expect(skill.code, skill.stderr).toBe(0)
      expect(skill.stdout).toContain('## When OCC wakes you')
      const version = await runProcess({
        program: childEnv.OCC_CLI_COMMAND!,
        args: ['--version'],
        env: { ...env, ...childEnv },
        timeoutMs: 15_000
      })
      expect(version.code, version.stderr).toBe(0)
      expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/u)
      const person = await runProcess({
        program: launcher,
        args: ['status', '--json'],
        env: { ...env, OCC_ENVIRONMENT: 'stale-shell-selection' },
        cwd: home,
        timeoutMs: 15_000
      })
      expect(person.code).not.toBe(0)
      expect(`${person.stdout}${person.stderr}`).toContain(
        'Unknown environment: stale-shell-selection'
      )
    } finally {
      await recordProfileDaemons(userData)
      await killChildAndWait(child)
      await killProfileDaemons(userData)
      await removeTestRoot(root)
    }
  },
  150_000
)
