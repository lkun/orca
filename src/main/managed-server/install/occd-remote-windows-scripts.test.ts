// Run the host script locally with a fake process-tree addon to exercise Windows identity rules.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runProcess, spawnProcess } from '@occ/process-host'
import { OCCD_WINDOWS_PROCESS_TREE_FILENAME } from '../../../shared/occd-artifacts'
import { OCCD_STOP_REQUEST_FILENAME } from '../../../shared/occd-stop-request'
import {
  OCCD_WINDOWS_PROCESS_FILENAME,
  OCCD_READINESS_FILENAME
} from './occd-remote-host-support'
import { parseOCCdReadinessWaitOutput } from './occd-remote-readiness-wait'
import { readOCCdWindowsEncodedAnswer } from './occd-remote-windows-node'
import {
  OCCD_RECORD_ABSENT_MARKER,
  OCCD_RECORD_PRESENT_MARKER,
  OCCD_WINDOWS_HOST_SCRIPT,
  OCCD_WINDOWS_READINESS_MARKER,
  OCCD_WINDOWS_RUNTIME_MARKER,
  OCCD_WINDOWS_ENTRY_MARKER,
  type OCCdWindowsHostOp
} from '../host-state/occd-windows-host-script'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'

const FAKE_ADDON_PRELOAD = [
  'const Module=require("module"),fs=require("fs");',
  'Module._extensions[".node"]=(m,f)=>{m.exports={getProcessCreationTime:(pid)=>{',
  'try{return JSON.parse(fs.readFileSync(f+".json","utf8"))[pid]}catch{return undefined}}}};'
].join('')
// Above default macOS/Linux PID ranges so kill(pid, 0) reports ESRCH.
const DEAD_PID = 4_194_303

let dir = ''
let preload = ''
let script = ''
const children: { kill: () => boolean }[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'occd-win-scripts-'))
  preload = join(dir, 'fake-addon-preload.js')
  writeFileSync(preload, FAKE_ADDON_PRELOAD)
  script = join(dir, 'occd-host-script.js')
  writeFileSync(script, OCCD_WINDOWS_HOST_SCRIPT)
})

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill()
  }
  rmSync(dir, { recursive: true, force: true })
})

async function runOp(op: OCCdWindowsHostOp, args: string[], withAddon = true) {
  return runProcess({
    program: process.execPath,
    args: [...(withAddon ? ['--require', preload] : []), script, op, ...args],
    timeoutMs: 15_000
  })
}

function stageAddon(creationTimes: Record<number, number>): void {
  writeFileSync(join(dir, OCCD_WINDOWS_PROCESS_TREE_FILENAME), '')
  writeFileSync(
    join(dir, `${OCCD_WINDOWS_PROCESS_TREE_FILENAME}.json`),
    JSON.stringify(creationTimes)
  )
}

function recordProcess(pid: number, creationTimeMs: number | null): void {
  writeFileSync(join(dir, OCCD_WINDOWS_PROCESS_FILENAME), JSON.stringify({ pid, creationTimeMs }))
}

function readyLine(health: Record<string, unknown>): string {
  return `${JSON.stringify({ type: 'occ_server_ready', runtimeId: 'r1', health })}\n`
}

describe('Windows liveness script', () => {
  const liveness = async (withAddon = true) => (await runOp('liveness', [dir], withAddon)).stdout

  it('is LIVE only when the PID runs and its creation time matches the record', async () => {
    stageAddon({ [process.pid]: 1000 })
    recordProcess(process.pid, 1000)
    expect(await liveness()).toBe('LIVE')
  })

  it('is DEAD for an exited PID and for a running PID with another creation time', async () => {
    stageAddon({ [process.pid]: 2000 })
    recordProcess(DEAD_PID, 1000)
    expect(await liveness()).toBe('DEAD')
    recordProcess(process.pid, 1000)
    expect(await liveness()).toBe('DEAD')
  })

  it('answers a whole GC pass of dirs from one process, in order', async () => {
    const live = join(dir, 'live')
    const dead = join(dir, 'dead')
    const unknown = join(dir, 'unknown')
    const neverLaunched = join(dir, 'never-launched')
    mkdirSync(unknown)
    writeFileSync(join(unknown, OCCD_READINESS_FILENAME), '')
    mkdirSync(neverLaunched)
    for (const [slot, pid] of [
      [live, process.pid],
      [dead, DEAD_PID]
    ] as const) {
      mkdirSync(slot)
      writeFileSync(join(slot, OCCD_WINDOWS_PROCESS_TREE_FILENAME), '')
      writeFileSync(
        join(slot, `${OCCD_WINDOWS_PROCESS_TREE_FILENAME}.json`),
        JSON.stringify({ [process.pid]: 1000 })
      )
      writeFileSync(
        join(slot, OCCD_WINDOWS_PROCESS_FILENAME),
        JSON.stringify({ pid, creationTimeMs: 1000 })
      )
    }
    const { stdout } = await runOp('liveness-many', [live, dead, unknown, neverLaunched])
    expect(stdout.trim()).toBe('__OCCD_LIVENESS__ LIVE,DEAD,UNKNOWN,NEVER_LAUNCHED')
  })

  it('is UNKNOWN when nothing proves identity: no record, no time, no addon', async () => {
    expect(await liveness()).toBe('NEVER_LAUNCHED')
    writeFileSync(join(dir, OCCD_READINESS_FILENAME), '')
    expect(await liveness()).toBe('UNKNOWN')
    recordProcess(process.pid, null)
    stageAddon({ [process.pid]: 1000 })
    expect(await liveness()).toBe('UNKNOWN')
    recordProcess(process.pid, 1000)
    expect(await liveness(false)).toBe('UNKNOWN')
    stageAddon({})
    expect(await liveness()).toBe('UNKNOWN')
  })
})

describe('Windows stop script', () => {
  const requestFile = () => join(dir, OCCD_STOP_REQUEST_FILENAME)
  const stop = async (justLaunched: boolean, waitSeconds = 5) =>
    (await runOp('stop', [dir, String(waitSeconds), justLaunched ? '1' : '0'])).stdout
      .trim()
      .split(/\r?\n/u)
      .at(-1)

  function fakeOCCd(): number {
    const child = spawnProcess({
      program: process.execPath,
      args: [
        '-e',
        'const fs=require("fs");setInterval(()=>{if(fs.existsSync(process.argv[1]))process.exit(0)},50)',
        requestFile()
      ]
    })
    children.push(child)
    if (!child.pid) {
      throw new Error('fake occd did not start')
    }
    return child.pid
  }

  it('asks a capable build through the request file and waits for it to exit', async () => {
    const pid = fakeOCCd()
    stageAddon({ [pid]: 1000 })
    recordProcess(pid, 1000)
    writeFileSync(join(dir, OCCD_READINESS_FILENAME), readyLine({ pid, stopRequests: 1 }))
    expect(await stop(false)).toBe('STOPPED')
  })

  it('writes the request for a just-launched candidate that has not published readiness', async () => {
    const pid = fakeOCCd()
    stageAddon({ [pid]: 1000 })
    recordProcess(pid, 1000)
    expect(await stop(true)).toBe('STOPPED')
  })

  it('refuses a build that cannot be asked, without writing anything', async () => {
    stageAddon({ [process.pid]: 1000 })
    recordProcess(process.pid, 1000)
    writeFileSync(join(dir, OCCD_READINESS_FILENAME), readyLine({ pid: process.pid }))
    expect(await stop(false)).toBe('UNSUPPORTED')
    expect(existsSync(requestFile())).toBe(false)
  })

  it('never addresses a PID the readiness record does not corroborate', async () => {
    stageAddon({ [process.pid]: 1000 })
    recordProcess(process.pid, 1000)
    writeFileSync(join(dir, OCCD_READINESS_FILENAME), readyLine({ pid: 1, stopRequests: 1 }))
    expect(await stop(false)).toBe('UNKNOWN')
    expect(existsSync(requestFile())).toBe(false)
    // Settled stops require readiness unless this client just launched the slot.
    writeFileSync(join(dir, OCCD_READINESS_FILENAME), '')
    expect(await stop(false)).toBe('UNKNOWN')
  })

  it('reports no record, an exited process, and one that outlives the wait', async () => {
    expect(await stop(true)).toBe('NO_PID')
    stageAddon({ [process.pid]: 1000 })
    recordProcess(DEAD_PID, 1000)
    expect(await stop(true)).toBe('ALREADY_EXITED')
    recordProcess(process.pid, 1000)
    expect(await stop(true, 0)).toBe('STILL_RUNNING')
    expect(existsSync(requestFile())).toBe(true)
  })
})

describe('Windows readiness wait script', () => {
  const host = getRemoteHostPlatform('win32-x64')
  const file = () => join(dir, OCCD_READINESS_FILENAME)
  const wait = async (seconds: number) => {
    const { stdout } = await runOp(
      'readiness-wait',
      [file(), String(256 * 1024), String(seconds)],
      false
    )
    return parseOCCdReadinessWaitOutput(host, stdout)
  }

  it('answers as soon as a line is complete, byte-exact through base64', async () => {
    const line = readyLine({ pid: 7, stopRequests: 1, dataDir: 'C:/Users/Zoë/.occ' })
    setTimeout(() => writeFileSync(file(), line), 300)
    const started = Date.now()
    const result = await wait(10)
    expect(Date.now() - started).toBeLessThan(8_000)
    expect(result).toMatchObject({ state: 'ready', readiness: { runtimeId: 'r1' } })
    expect(result.state === 'ready' && result.readiness.health).toMatchObject({
      dataDir: 'C:/Users/Zoë/.occ'
    })
  })

  it('is still pending when its bounded wait ends on a partial line', async () => {
    writeFileSync(file(), '{"type":"occ_ser')
    expect(await wait(1)).toEqual({ state: 'pending' })
  })

  it('reads a missing file as nothing yet', async () => {
    expect(await wait(0)).toEqual({ state: 'pending' })
  })
})

describe('Windows record scripts', () => {
  const read = (path: string, max = 1024) => runOp('record-read', [path, String(max)], false)

  it('tells absent from present, and returns the bytes exactly', async () => {
    const path = join(dir, 'occd-active.json')
    expect((await read(path)).stdout.trim()).toBe(OCCD_RECORD_ABSENT_MARKER)
    writeFileSync(path, '{"active":"0.2.0+bb01","owner":"Zoë"}')
    const present = await read(path)
    expect(readOCCdWindowsEncodedAnswer(present.stdout, OCCD_RECORD_PRESENT_MARKER)).toBe(
      '{"active":"0.2.0+bb01","owner":"Zoë"}'
    )
  })

  it('refuses an oversized record or a directory rather than reading it as absent', async () => {
    const path = join(dir, 'big.json')
    writeFileSync(path, 'x'.repeat(2048))
    expect((await read(path)).code).toBe(65)
    mkdirSync(join(dir, 'a-dir'))
    expect((await read(join(dir, 'a-dir'))).code).toBe(65)
  })

  it('publishes a staged record over the existing one', async () => {
    const path = join(dir, 'transaction.json')
    const staged = `${path}.partial.1.abc`
    writeFileSync(path, 'old')
    writeFileSync(staged, 'new')
    const result = await runOp('record-publish', [staged, path], false)
    expect(result.code).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe('new')
    expect(existsSync(staged)).toBe(false)
  })

  it('fails without a stage rather than publishing nothing', async () => {
    const result = await runOp(
      'record-publish',
      [join(dir, 'missing'), join(dir, 'transaction.json')],
      false
    )
    expect(result.code).not.toBe(0)
  })
})

describe('Windows host script staging', () => {
  it('answers present from a whole script, and installs itself from its partial upload', async () => {
    expect((await runOp('script-present', [], false)).stdout.trim()).toBe(
      'OCCD_HOST_SCRIPT_PRESENT'
    )
    const partial = join(dir, 'staged.partial')
    const target = join(dir, 'installed.js')
    writeFileSync(partial, OCCD_WINDOWS_HOST_SCRIPT)
    const installed = await runProcess({
      program: process.execPath,
      args: [partial, 'script-install', target],
      timeoutMs: 15_000
    })
    expect(installed.stdout.trim()).toBe('OCCD_HOST_SCRIPT_PRESENT')
    expect(existsSync(partial)).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe(OCCD_WINDOWS_HOST_SCRIPT)
  })
})

describe('Windows slot runtime and file removal', () => {
  const slot = () => join(dir, 'occd-0.2.0+bb01')
  const sha = 'a'.repeat(64)

  it('names the runtime the slot marker points at, and clears a stale stop request on launch', async () => {
    mkdirSync(slot())
    writeFileSync(join(slot(), '.runtime-node'), `${sha}\n`)
    writeFileSync(join(slot(), OCCD_STOP_REQUEST_FILENAME), '')
    expect((await runOp('slot-runtime', [slot()], false)).code).toBe(78)
    mkdirSync(join(dir, 'runtimes', `node-${sha}`), { recursive: true })
    writeFileSync(join(dir, 'runtimes', `node-${sha}`, 'node.exe'), '')
    const plain = await runOp('slot-runtime', [slot()], false)
    expect(readOCCdWindowsEncodedAnswer(plain.stdout, OCCD_WINDOWS_RUNTIME_MARKER)).toBe(
      join(dir, 'runtimes', `node-${sha}`, 'node.exe')
    )
    expect(readOCCdWindowsEncodedAnswer(plain.stdout, OCCD_WINDOWS_ENTRY_MARKER)).toBe(
      join(slot(), 'occd.js')
    )
    writeFileSync(join(slot(), 'occd-server.js'), '')
    const split = await runOp('slot-runtime', [slot()], false)
    expect(readOCCdWindowsEncodedAnswer(split.stdout, OCCD_WINDOWS_ENTRY_MARKER)).toBe(
      join(slot(), 'occd-server.js')
    )
    expect(existsSync(join(slot(), OCCD_STOP_REQUEST_FILENAME))).toBe(true)
    await runOp('slot-runtime', [slot(), 'clear-stop-request'], false)
    expect(existsSync(join(slot(), OCCD_STOP_REQUEST_FILENAME))).toBe(false)
  })

  it('refuses a marker that is not a bare sha256', async () => {
    mkdirSync(slot())
    writeFileSync(join(slot(), '.runtime-node'), '../../escape')
    expect((await runOp('slot-runtime', [slot()], false)).code).toBe(78)
  })

  it('removes a file and treats an absent one as removed', async () => {
    const file = join(dir, 'staged.json')
    writeFileSync(file, '{}')
    expect((await runOp('remove-file', [file], false)).code).toBe(0)
    expect(existsSync(file)).toBe(false)
    expect((await runOp('remove-file', [file], false)).code).toBe(0)
  })

  it('rejects an unknown op', async () => {
    const result = await runProcess({ program: process.execPath, args: [script, 'nope'] })
    expect(result.code).toBe(64)
  })
})

it('decodes nothing from output that lacks the marker', () => {
  expect(readOCCdWindowsEncodedAnswer('noise\r\n', OCCD_WINDOWS_READINESS_MARKER)).toBeNull()
})

describe('Windows installed build identity', () => {
  it.each([false, true])('matches the server hash for split entry %s', async (splitEntry) => {
    const launcher = join(dir, 'occd.js')
    writeFileSync(launcher, 'launcher\n')
    if (splitEntry) {
      writeFileSync(join(dir, 'occd-server.js'), 'server\n')
    }
    const result = await runOp('build-hash', [launcher], false)
    expect(result.code).toBe(0)
    const legacyHash = createHash('sha256').update('launcher\n').digest('hex').slice(0, 16)
    expect(result.stdout.trim()).toBe(`__OCCD_BUILD_HASH__ ${legacyHash}`)
  })
})
