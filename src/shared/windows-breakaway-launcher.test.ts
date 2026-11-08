import { describe, expect, it } from 'vitest'

import {
  OCCD_WINDOWS_BREAKAWAY_CONTRACT,
  parseWindowsBreakawayLaunchReport,
  WINDOWS_BREAKAWAY_EXIT_CODES as RELAY_WINDOWS_BREAKAWAY_EXIT_CODES,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG as RELAY_WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  type WindowsBreakawayLaunchContract
} from './windows-breakaway-launch'
import {
  launchOutsideJob,
  parseWindowsBreakawayLaunchRequest,
  type SpawnOutsideJob,
  type WindowsBreakawayLauncher
} from './windows-breakaway-launcher'

// The launcher is contract-agnostic; this stands in for the retired relay's contract.
const RELAY_WINDOWS_BREAKAWAY_CONTRACT: WindowsBreakawayLaunchContract = {
  argsFlag: '--relay-args',
  reportMarker: 'OCC_RELAY_LAUNCH'
}

const parseRelayWindowsBreakawayLaunch = (args: readonly string[]) =>
  parseWindowsBreakawayLaunchRequest(RELAY_WINDOWS_BREAKAWAY_CONTRACT, args)

function launcherFor(
  spawn: SpawnOutsideJob,
  creationTimeMs: number | null = null
): WindowsBreakawayLauncher {
  return { spawnOutsideJob: spawn, readCreationTimeMs: () => creationTimeMs }
}

const argv = [
  'C:\\rt\\node.exe',
  'C:\\Users\\me user\\.occ-remote\\relay-1\\relay.js',
  RELAY_WINDOWS_BREAKAWAY_LAUNCH_FLAG,
  '--stdout-file',
  'C:/Users/me user/relay.log',
  '--stderr-file',
  'C:/Users/me user/relay.err.log',
  '--relay-args',
  '--detached',
  '--sock-path',
  '\\\\.\\pipe\\occ-relay-1',
  '--log-file',
  'C:/Users/me user/relay.log'
]

describe('relay Windows breakaway launcher', () => {
  it('takes its own flags before -- and hands the rest to the relay', () => {
    expect(parseRelayWindowsBreakawayLaunch(argv)).toEqual({
      stdoutPath: 'C:/Users/me user/relay.log',
      stderrPath: 'C:/Users/me user/relay.err.log',
      env: {},
      programArgs: argv.slice(8)
    })
  })
})

describe('occd Windows breakaway launcher', () => {
  const occdArgv = [
    'C:\\rt\\node.exe',
    'C:\\Users\\me\\.occ-remote\\occd-1\\occd.js',
    RELAY_WINDOWS_BREAKAWAY_LAUNCH_FLAG,
    '--stdout-file',
    'C:/slot/.occd-readiness',
    '--stderr-file',
    'C:/slot/occd.log',
    '--process-file',
    'C:/slot/.occd-process.json',
    '--occd-args',
    '--json',
    '--bind',
    '127.0.0.1'
  ]
  const occdRuntime = { execPath: occdArgv[0], script: occdArgv[1], cwd: 'C:/slot' }

  it('splits on its own args flag, not the relay one', () => {
    expect(parseWindowsBreakawayLaunchRequest(OCCD_WINDOWS_BREAKAWAY_CONTRACT, occdArgv)).toEqual(
      {
        stdoutPath: 'C:/slot/.occd-readiness',
        stderrPath: 'C:/slot/occd.log',
        processFilePath: 'C:/slot/.occd-process.json',
        env: {},
        programArgs: ['--json', '--bind', '127.0.0.1']
      }
    )
  })

  it('collects --env assignments for the launched process and refuses a malformed one', () => {
    const withEnv = [
      ...occdArgv.slice(0, 3),
      '--env',
      'OCC_VERSION=0.2.0+bb01',
      '--env',
      'OCC_USER_DATA=C:/Users/Ann Lee/.occ',
      ...occdArgv.slice(3)
    ]
    expect(
      parseWindowsBreakawayLaunchRequest(OCCD_WINDOWS_BREAKAWAY_CONTRACT, withEnv)?.env
    ).toEqual({ OCC_VERSION: '0.2.0+bb01', OCC_USER_DATA: 'C:/Users/Ann Lee/.occ' })
    expect(() =>
      parseWindowsBreakawayLaunchRequest(OCCD_WINDOWS_BREAKAWAY_CONTRACT, [
        ...occdArgv.slice(0, 3),
        '--env',
        'lower=1',
        ...occdArgv.slice(3)
      ])
    ).toThrow('NAME=VALUE')
  })

  it('fails the launch and stops the process when its record cannot be written', () => {
    const request = parseWindowsBreakawayLaunchRequest(OCCD_WINDOWS_BREAKAWAY_CONTRACT, occdArgv)
    if (!request) {
      throw new Error('expected a launch request')
    }
    const terminated: number[] = []
    const outcome = launchOutsideJob(
      request,
      launcherFor(() => ({ ok: true, pid: 4242, inJob: false })),
      occdRuntime,
      () => {
        throw Object.assign(new Error('EACCES'), { errno: -4048 })
      },
      (pid) => terminated.push(pid)
    )
    expect(outcome).toEqual({
      report: { method: 'failed', reason: 'process-file', code: -4048 },
      exitCode: RELAY_WINDOWS_BREAKAWAY_EXIT_CODES.failed
    })
    expect(terminated).toEqual([4242])
  })

  it('reports under its own marker, which the relay parser does not read', () => {
    const line = 'OCC_OCCD_LAUNCH {"method":"breakaway","pid":9,"inJob":false}'
    expect(parseWindowsBreakawayLaunchReport(OCCD_WINDOWS_BREAKAWAY_CONTRACT, line)).toEqual({
      method: 'breakaway',
      pid: 9,
      inJob: false
    })
    expect(parseWindowsBreakawayLaunchReport(RELAY_WINDOWS_BREAKAWAY_CONTRACT, line)).toBeNull()
  })
})
