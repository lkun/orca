import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RecordFile from './occd-remote-record-file'
import type * as InstallLock from './remote-install-lock'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))
vi.mock('./remote-install-lock', async (importOriginal) => ({
  ...(await importOriginal<typeof InstallLock>()),
  acquireInstallLock: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./occd-remote-record-file', async (importOriginal) => ({
  ...(await importOriginal<typeof RecordFile>()),
  writeAtomicOCCdRemoteRecord: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./remote-install-gc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  gcOldRemoteInstallVersions: vi.fn().mockResolvedValue(undefined)
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { writeAtomicOCCdRemoteRecord } from './occd-remote-record-file'
import { gcOldRemoteInstallVersions } from './remote-install-gc'
import { decommissionRemoteOCCd } from './occd-remote-decommission'
import { gcOldOCCdVersions } from './occd-remote-gc'
import {
  emptyOCCdActivationRecord,
  withActivatedVersion
} from '../activation/occd-activation-record'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'

const mockExec = vi.mocked(execCommand)
const host = getRemoteHostPlatform('win32-x64')
const VERSION = '0.2.0+bb01'
const SLOT_NODE = 'C:\\Users\\u\\.occ-remote\\runtimes\\node-ab\\node.exe'
const record = withActivatedVersion(emptyOCCdActivationRecord(), VERSION, null, new Date(0))
const encoded = (marker: string, value: string): string =>
  `${marker} ${Buffer.from(value).toString('base64')}\r\n`
const lock = {
  pid: 4242,
  startedAtMs: 1_700_000_000_123,
  identity: 'u',
  version: VERSION,
  acquiredAt: '2026-10-01T00:00:00.000Z',
  nonce: 'nonce-1'
}

function conn() {
  return Object.assign(Object.create(null), { writeFile: vi.fn().mockResolvedValue(undefined) })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('decommissioning a Windows occd', () => {
  it('stops it by a staged managed request and records that nothing serves', async () => {
    const log: string[] = []
    mockExec.mockImplementation(async (_conn, command: string) => {
      const text = String(command)
      log.push(text)
      const op = /\.js (?:--fence \S+ \S+ )?([a-z-]+)(?: |$)/u.exec(text)?.[1] ?? ''
      if (op === 'record-read') {
        if (text.includes('occd-active.json')) {
          return encoded('__OCCD_RECORD_PRESENT__', JSON.stringify(record))
        }
        return text.includes('occd.lock')
          ? encoded('__OCCD_RECORD_PRESENT__', JSON.stringify(lock))
          : '__OCCD_RECORD_ABSENT__\r\n'
      }
      if (op === 'readiness-wait') {
        return encoded(
          '__OCCD_READINESS__',
          `${JSON.stringify({ type: 'occ_server_ready', runtimeId: 'r1', health: { pid: 4242, stopRequests: 1 } })}\n`
        )
      }
      if (op === 'slot-runtime') {
        return encoded('__OCCD_RUNTIME__', SLOT_NODE)
      }
      if (op === 'fence-check') {
        return 'OK'
      }
      if (op === 'fence-release') {
        return 'RELEASED'
      }
      if (op === 'remove-file' || op === 'remove-tree') {
        return ''
      }
      if (text.includes('--complete-managed-stop')) {
        const staged = /--request-file (\S+)/u.exec(text)?.[1] ?? ''
        const writes = vi.mocked(options.conn.writeFile).mock.calls
        const request = JSON.parse(String(writes.find(([path]) => path === staged)?.[1]))
        return `${JSON.stringify({ ...request, kind: 'occd_managed_stop_completion', verdict: 'exited', receiptPersisted: true, retirement: 'retired' })}\r\n`
      }
      throw new Error(`unexpected Windows command: ${text}`)
    })
    const options = {
      conn: conn(),
      host,
      remoteHome: 'C:/Users/u',
      nodePath: 'C:/host/node.exe',
      userDataDir: 'C:/Users/u/.occ',
      bindHost: '127.0.0.1',
      port: 7777,
      record,
      census: { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: 3 },
      now: () => new Date('2026-10-02T00:00:00.000Z')
    }
    expect(await decommissionRemoteOCCd(options)).toEqual({
      outcome: 'decommissioned',
      version: VERSION,
      retirement: 'retired'
    })
    const written = vi
      .mocked(writeAtomicOCCdRemoteRecord)
      .mock.calls.find(([, path]) => path.endsWith('occd-active.json'))
    expect(JSON.parse(written?.[2] ?? '{}')).toMatchObject({ active: null, previous: VERSION })
    for (const command of log) {
      expect(command).not.toMatch(/EncodedCommand|kill |SIGTERM|taskkill|Stop-Process/u)
      expect(command).not.toContain('nonce-1')
    }
    expect(log.some((command) => command.startsWith(`${SLOT_NODE} `))).toBe(true)
  })
})

describe('Windows occd GC', () => {
  const gcOptions = () => ({
    conn: conn(),
    host,
    remoteHome: 'C:/Users/u',
    currentDirAbsPath: 'C:/Users/u/.occ-remote/occd-0.3.0+cc01',
    record
  })

  async function screen(answer: string | Error): Promise<readonly string[] | null> {
    mockExec.mockImplementation(async (_conn, command: string) => {
      if (String(command).includes(' record-read ')) {
        return '__OCCD_RECORD_ABSENT__\r\n'
      }
      if (String(command).startsWith('powershell.exe ')) {
        return 'OPEN'
      }
      if (answer instanceof Error) {
        throw answer
      }
      return answer
    })
    await gcOldOCCdVersions(gcOptions())
    const passOptions = vi.mocked(gcOldRemoteInstallVersions).mock.calls[0]?.[5]
    return (
      (await passOptions?.resolveExtraPinnedDirNames?.(['occd-a', 'occd-b', 'occd-c'])) ?? null
    )
  }

  it('screens every candidate in one node.exe and pins all but the proven dead', async () => {
    expect(await screen('__OCCD_LIVENESS__ LIVE,DEAD,UNKNOWN\r\n')).toEqual(['occd-a', 'occd-c'])
    const screens = mockExec.mock.calls.filter(([, command]) =>
      String(command).includes('liveness-many')
    )
    expect(screens).toHaveLength(1)
    expect(String(screens[0]?.[1])).toContain(
      'C:/Users/u/.occ-remote/occd-a C:/Users/u/.occ-remote/occd-b C:/Users/u/.occ-remote/occd-c'
    )
  })

  it('deletes nothing when the host cannot answer for every candidate', async () => {
    expect(await screen('__OCCD_LIVENESS__ DEAD,DEAD\r\n')).toBeNull()
    vi.clearAllMocks()
    expect(await screen(new Error('exit 1'))).toBeNull()
  })
})
