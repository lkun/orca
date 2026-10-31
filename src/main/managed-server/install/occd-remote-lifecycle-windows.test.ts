import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import type * as TerminalBarrier from '../lifecycle/occd-rollback-terminal-barrier'
// Fake Windows lifecycle host must reject POSIX/encoded commands and PowerShell hops on occd operations.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RecordFile from './occd-remote-record-file'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))
vi.mock('./remote-install-lock', () => ({
  acquireInstallLock: vi.fn().mockResolvedValue(undefined),
  RELAY_INSTALL_LOCK_NAME: '.install-lock'
}))
vi.mock('./remote-install-transfers', () => ({
  uploadRemoteInstallDirectory: vi.fn().mockResolvedValue(undefined),
  writeRemoteInstallFile: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./occd-remote-record-file', async (importOriginal) => ({
  ...(await importOriginal<typeof RecordFile>()),
  writeAtomicOCCdRemoteRecord: vi.fn().mockResolvedValue(undefined)
}))
// Dedicated Windows decommission tests exercise the real stop commands.
vi.mock('../lifecycle/occd-rollback-terminal-barrier', async (importOriginal) => ({
  ...(await importOriginal<typeof TerminalBarrier>()),
  readOCCdRollbackBarrierTarget: async (_options: unknown, version: string) => ({
    state: 'ready',
    context: {
      version,
      runtimeId: 'r1',
      instance: { pid: 4242, startedAtMs: 1, nonce: 'n', lockPath: 'C:/l' }
    }
  }),
  stopIncumbentBehindTerminalBarrier: async () => ({ state: 'retired' })
}))
vi.mock('./occd-remote-node-runtime', () => ({
  ensureRemoteOCCdNodeRuntime: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../../ssh/occd-local-build-hash', () => ({
  computeLocalOCCdBuildHash: () => 'abc123def4567890'
}))
vi.mock('./remote-versioned-install', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readLocalFullVersion: () => '0.2.0+bb0100000000',
  isRemoteInstallComplete: vi.fn().mockResolvedValue(false),
  finalizeInstall: vi.fn().mockResolvedValue(undefined),
  abandonInstall: vi.fn().mockResolvedValue(undefined)
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { deployOCCd, type OCCdDeployOptions } from '../../ssh/occd-remote-deploy'
import { rollbackOCCd } from './occd-remote-rollback'
import { emptyOCCdActivationRecord } from '../activation/occd-activation-record'
import { writeAtomicOCCdRemoteRecord } from './occd-remote-record-file'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { NODE_RUNTIME_PIN } from '../../../shared/node-runtime-pin'

const mockExec = vi.mocked(execCommand)
const host = getRemoteHostPlatform('win32-x64')
const VERSION = '0.2.0+bb0100000000'
const SLOT_NODE = 'C:\\Users\\u\\.occ-remote\\runtimes\\node-ab\\node.exe'

const encoded = (marker: string, value: string): string =>
  `${marker} ${Buffer.from(value).toString('base64')}\r\n`

const TARGET = '0.1.0+aa01'

function readyLine(version = VERSION): string {
  return `${JSON.stringify({
    type: 'occ_server_ready',
    runtimeId: 'r1',
    boundEndpoint: 'ws://127.0.0.1:7777',
    advertisedEndpoint: null,
    managedWslCliReconciliation: 'settled',
    pairing: { available: false, reason: 'disabled_by_operator', guidance: 'n/a' },
    health: {
      buildHash: 'abc123def4567890',
      buildVersion: version,
      nodeVersion: NODE_RUNTIME_PIN.version,
      nodeAbi: '137',
      platform: 'win32',
      arch: 'x64',
      pid: 4242,
      stopRequests: 1,
      terminalDaemon: {
        state: 'live',
        ownsFreshSessions: true,
        pid: 2,
        buildVersion: version,
        entryPath: 'C:/x/daemon-entry.js',
        protocolVersion: 3,
        selfTest: { ok: true, coverage: 'handshake', verdict: 'healthy', durationMs: 5 }
      }
    }
  })}\n`
}

function scriptWindowsHost(log: string[], activeRecord: string | null = null): void {
  mockExec.mockImplementation(async (_conn, command: string) => {
    const text = String(command)
    log.push(text)
    const op = /\.js (?:--fence \S+ \S+ )?([a-z-]+)(?: |$)/u.exec(text)?.[1] ?? ''
    switch (op) {
      case 'record-read':
        return activeRecord && text.includes('occd-active.json')
          ? encoded('__OCCD_RECORD_PRESENT__', activeRecord)
          : '__OCCD_RECORD_ABSENT__\r\n'
      case 'build-hash':
        return '__OCCD_BUILD_HASH__ abc123def4567890\r\n'
      case 'owner-admission':
        return 'CLEAR'
      case 'slot-runtime':
        return encoded('__OCCD_RUNTIME__', SLOT_NODE)
      case 'readiness-wait':
        return encoded('__OCCD_READINESS__', readyLine(text.includes(TARGET) ? TARGET : VERSION))
      case 'stop':
        return 'STOPPED'
      case 'snapshot-probe':
        return 'PRESENT'
      case 'snapshot-restore':
        return 'RESTORED'
      case 'state-newest-mtime':
        return 'UNKNOWN'
      case 'snapshot-capture':
        return 'CAPTURED'
      case 'remove-file':
      case 'remove-tree':
        return ''
      case 'fence-check':
        return 'OK'
      case 'fence-release':
        return 'RELEASED'
      default:
        break
    }
    if (text.includes('--occd-profile-state-preflight')) {
      return JSON.stringify({
        type: 'occ_profile_state_ready',
        nonce: text.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/)?.[0],
        runtime: 'node',
        runtimeVersion: NODE_RUNTIME_PIN.version,
        sqliteVersion: '3.51.0',
        artifactVersion: VERSION,
        revision: 1
      })
    }
    if (text.includes('--windows-breakaway-launch')) {
      return 'OCC_OCCD_LAUNCH {"method":"breakaway","pid":4242,"inJob":false}\r\n'
    }
    // Shared relay install fences retain this pre-existing PowerShell path.
    if (text.startsWith('powershell.exe ')) {
      return 'OPEN'
    }
    throw new Error(`unexpected Windows command: ${text}`)
  })
}

function options(): OCCdDeployOptions {
  const census = { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: 3 }
  return {
    conn: Object.assign(Object.create(null), { writeFile: vi.fn().mockResolvedValue(undefined) }),
    host,
    remoteHome: 'C:/Users/u',
    localOCCdDir: '/local/out/occd',
    target: 'win32-x64',
    nodePath: 'C:/host/node.exe',
    userDataDir: 'C:/Users/u/.occ',
    bindHost: '127.0.0.1',
    port: 7777,
    census,
    recountCensus: async () => census,
    releaseIncumbentAdmission: async () => {},
    readinessTimeoutMs: 1_000,
    sleep: async () => {},
    now: () => new Date('2026-10-02T00:00:00.000Z')
  }
}

beforeEach(() => {
  mockExec.mockReset()
  vi.mocked(writeAtomicOCCdRemoteRecord).mockClear()
})

describe('deployOCCd on a Windows host', () => {
  it('activates a first install through node.exe host ops only', async () => {
    const log: string[] = []
    scriptWindowsHost(log)
    const result = await deployOCCd(options())
    expect(result).toMatchObject({ outcome: 'installed-and-activated', fullVersion: VERSION })
    const occdOps = log.filter((command) => !command.startsWith('powershell.exe '))
    expect(occdOps.length).toBeGreaterThan(0)
    for (const command of occdOps) {
      expect(command).not.toMatch(/EncodedCommand|nohup|kill |head -c|tar |\bsh -c\b/u)
    }
    const ops = occdOps.map(
      (command) => /\.js (?:--fence \S+ \S+ )?([a-z-]+)/u.exec(command)?.[1] ?? command
    )
    expect(ops).toContain('owner-admission')
    expect(ops).toContain('snapshot-capture')
    expect(ops.indexOf('slot-runtime')).toBeLessThan(
      ops.findIndex((entry) => entry.includes('--windows-breakaway-launch'))
    )
    expect(ops).toContain('readiness-wait')
    const record = vi
      .mocked(writeAtomicOCCdRemoteRecord)
      .mock.calls.find(([, path]) => path.endsWith('occd-active.json'))
    expect(JSON.parse(record?.[2] ?? '{}')).toMatchObject({ active: VERSION })
  })

  it('rolls back by managed stop, directory snapshot and node.exe launch', async () => {
    const log: string[] = []
    const record = {
      ...emptyOCCdActivationRecord(),
      active: VERSION,
      previous: TARGET,
      activatedAt: '2026-10-01T00:00:00.000Z',
      snapshot: {
        dirName: `pre-${VERSION}-1000`,
        takenBeforeVersion: VERSION,
        readableByVersion: TARGET,
        takenAt: '2026-10-01T00:00:00.000Z'
      }
    }
    scriptWindowsHost(log, JSON.stringify(record))
    const { localOCCdDir: _dir, target: _target, force: _force, ...base } = options()
    const result = await rollbackOCCd({
      ...base,
      record,
      targetBuildHash: 'abc123def4567890',
      targetDaemonProtocol: { protocolVersion: 3, previousProtocolVersions: [1, 2] }
    })
    expect(result).toMatchObject({ outcome: 'rolled-back', target: TARGET })
    const ops = log.map(
      (command) => /\.js (?:--fence \S+ \S+ )?([a-z-]+)/u.exec(command)?.[1] ?? command
    )
    expect(ops).toEqual([
      'record-read',
      'snapshot-probe',
      'state-newest-mtime',
      'build-hash',
      'snapshot-capture',
      'snapshot-restore',
      'slot-runtime',
      // Commands outside the host script require a separate fence check immediately before dispatch.
      'fence-check',
      '--windows-breakaway-launch',
      'readiness-wait',
      'record-read',
      'fence-release'
    ])
    for (const command of log) {
      expect(command).not.toMatch(/EncodedCommand|kill |tar |nohup/u)
    }
  })
})
