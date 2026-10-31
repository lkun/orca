import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecCommandModule from '../ssh/remote-exec/remote-exec-command'
import { runProcess } from '@occ/process-host'

vi.mock('../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))

import { execCommand } from '../ssh/remote-exec/remote-exec-command'
import {
  emptyOCCdActivationRecord,
  serializeOCCdActivationRecord,
  withActivatedVersion
} from '../managed-server/activation/occd-activation-record'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'
import type { OCCdHostTransport } from '../ssh/occd-host-transport'
import {
  createWslOCCdConnectStateReader,
  parseWslOCCdConnectState,
  wslOCCdConnectStateHints
} from './wsl-occd-connect-state-snapshot'

const mockExec = vi.mocked(execCommand)
const host = getRemoteHostPlatform('linux-x64')
const ACTIVE = withActivatedVersion(
  emptyOCCdActivationRecord(),
  '0.1.0+aa01',
  null,
  new Date('2026-02-02T00:00:00.000Z')
)
let home: string

function target() {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: execCommand is mocked, so the transport is never used.
  const conn = Object.create(null) as OCCdHostTransport
  return { conn, host, remoteHome: home, userDataDir: join(home, '.occ') }
}

function write(relative: string, content: string): void {
  const path = join(home, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'occ-wsl-connect-state-'))
  mockExec.mockReset()
  mockExec.mockImplementation(async (_conn, command) => {
    const result = await runProcess({ program: '/bin/sh', args: ['-c', command] })
    if (result.code !== 0) {
      throw new Error(result.stderr)
    }
    return result.stdout
  })
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('WSL connect state snapshot', () => {
  it('reads a fresh host in one command', async () => {
    const reader = createWslOCCdConnectStateReader()

    await expect(reader.readActivationRecord(target())).resolves.toEqual(
      emptyOCCdActivationRecord()
    )

    expect(mockExec).toHaveBeenCalledOnce()
    expect(reader.snapshot()).toEqual({
      activation: { state: 'absent' },
      transactionAbsent: true,
      instanceLock: { state: 'absent' },
      fenceOpen: true
    })
  })

  it('reads the record, a pending journal, the instance lock and a held fence together', async () => {
    write('.occ-remote/occd-active.json', serializeOCCdActivationRecord(ACTIVE))
    write('.occ-remote/.occd-activation-transaction/transaction.json', '{"partial"')
    mkdirSync(join(home, '.occ-remote/.occd-activation-transaction/.install-lock'))
    write('.occ/occd.lock', '{"pid":7}\n')
    const reader = createWslOCCdConnectStateReader()

    await expect(reader.readActivationRecord(target())).resolves.toEqual(ACTIVE)

    expect(mockExec).toHaveBeenCalledOnce()
    expect(reader.snapshot()).toMatchObject({
      transactionAbsent: false,
      instanceLock: { state: 'present', raw: '{"pid":7}' },
      fenceOpen: false
    })
  })

  it('fails closed on an oversized record, as the plain read does', async () => {
    write('.occ-remote/occd-active.json', `"${'x'.repeat(70 * 1024)}"`)
    const reader = createWslOCCdConnectStateReader()

    // The plain read refuses an oversized file too (exit 65), so the connect still fails closed.
    await expect(reader.readActivationRecord(target())).rejects.toThrow()
    expect(mockExec).toHaveBeenCalledTimes(2)
    expect(reader.snapshot()).toBeNull()
  })

  it('falls back to the plain record read when the answer has another shape', async () => {
    write('.occ-remote/occd-active.json', serializeOCCdActivationRecord(ACTIVE))
    mockExec.mockImplementationOnce(async () => 'startup noise\n')
    const reader = createWslOCCdConnectStateReader()

    await expect(reader.readActivationRecord(target())).resolves.toEqual(ACTIVE)

    expect(mockExec).toHaveBeenCalledTimes(2)
    expect(reader.snapshot()).toBeNull()
  })
})

describe.skipIf(process.platform === 'win32')('WSL connect state snapshot fallbacks', () => {
  it('falls back to the plain read when the snapshot command itself fails', async () => {
    write('.occ-remote/occd-active.json', serializeOCCdActivationRecord(ACTIVE))
    mockExec.mockImplementationOnce(async () => {
      throw new Error('transport closed')
    })
    const reader = createWslOCCdConnectStateReader()

    await expect(reader.readActivationRecord(target())).resolves.toEqual(ACTIVE)
    expect(reader.snapshot()).toBeNull()
  })

  it('gives no hints when only the fallback read could answer the record', async () => {
    write('.occ-remote/occd-active.json', serializeOCCdActivationRecord(ACTIVE))
    mockExec.mockImplementationOnce(
      async () =>
        'UNREADABLE\n__OCC_WSL_CONNECT_STATE_END__\nABSENT\n__OCC_WSL_CONNECT_STATE_END__\n' +
        'ABSENT\n__OCC_WSL_CONNECT_STATE_END__\nNONE\n__OCC_WSL_CONNECT_STATE_END__\nOPEN\n'
    )
    const reader = createWslOCCdConnectStateReader()

    await expect(reader.readActivationRecord(target())).resolves.toEqual(ACTIVE)
    expect(reader.snapshot()).toBeNull()
  })
})

describe.runIf(process.platform === 'linux')('WSL connect state snapshot on a Linux guest', () => {
  it("reads the lock holder's identity in the same command", async () => {
    write('.occ/occd.lock', `${JSON.stringify({ pid: process.pid, version: '0.1.0' })}\n`)
    const reader = createWslOCCdConnectStateReader()

    await reader.readActivationRecord(target())

    expect(mockExec).toHaveBeenCalledOnce()
    const lock = reader.snapshot()?.instanceLock
    expect(lock?.state === 'present' && lock.holder?.pid).toBe(process.pid)
    expect(lock?.state === 'present' && lock.holder?.guest.occd).toMatch(`${process.pid}:`)
  })
})

describe('parseWslOCCdConnectState', () => {
  const end = '\n__OCC_WSL_CONNECT_STATE_END__\n'
  const stat = (pid: number) =>
    `${pid} (node) S ${Array.from({ length: 18 }, () => '0').join(' ')} 77 0`
  const identity = (pid: number) =>
    `PID ${pid}\n0f6e1d2c-3b4a-4958-8776-655443322110\n--occ-identity--\n${stat(1)}\n` +
    `--occ-identity--\n${stat(pid)}\n--occ-identity--\n`
  const answer = (holder: string) =>
    `ABSENT${end}ABSENT${end}PRESENT\n{"pid":9}${end}${holder}${end}OPEN\n`

  it('attaches the holder identity to a present lock, and nothing it cannot parse', () => {
    const lock = parseWslOCCdConnectState(answer(identity(9)))?.instanceLock
    expect(lock).toMatchObject({ state: 'present', holder: { pid: 9, guest: { occd: '9:77' } } })
    expect(parseWslOCCdConnectState(answer('NONE'))?.instanceLock).toEqual({
      state: 'present',
      raw: '{"pid":9}'
    })
    expect(parseWslOCCdConnectState(answer('PID 9\nnoise'))?.instanceLock).not.toHaveProperty(
      'holder'
    )
  })

  it('rejects a truncated answer', () => {
    expect(parseWslOCCdConnectState('ABSENT\n__OCC_WSL_CONNECT_STATE_END__\n')).toBeNull()
  })
})

describe('wslOCCdConnectStateHints', () => {
  const snapshot = {
    activation: { state: 'ok' as const, record: ACTIVE },
    transactionAbsent: true,
    instanceLock: { state: 'absent' as const },
    fenceOpen: true
  }

  it('hints while the record the snapshot read is the one acted on', () => {
    const hints = wslOCCdConnectStateHints(snapshot, ACTIVE)
    expect(hints.instanceLock(ACTIVE)).toEqual({ state: 'absent' })
    expect(hints.deployPreRead(ACTIVE)).toEqual({ preRead: { record: ACTIVE, fenceOpen: true } })
  })

  it('stops hinting once recovery, adoption or admission replaced the record', () => {
    const hints = wslOCCdConnectStateHints(snapshot, ACTIVE)
    const replaced = { ...ACTIVE }
    expect(hints.instanceLock(replaced)).toBeUndefined()
    expect(hints.deployPreRead(replaced)).toEqual({})
  })
})
