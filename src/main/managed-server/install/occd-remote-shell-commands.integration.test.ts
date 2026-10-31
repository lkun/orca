// Execute generated commands in /bin/sh to catch quoting and shell-semantic errors.
import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  exportProfileStateJson,
  importProfileStateJson
} from '../../persistence/profile-state/profile-state-documents'
import { openProfileStateDatabase } from '../../persistence/profile-state/profile-state-database'

import {
  occdLaunchCommand,
  occdLivenessAnswerBlocksGc,
  occdLivenessProbeCommand,
  parseOCCdLiveness,
  parseOCCdReadinessOutput
} from './occd-remote-launch'
import { OCCD_PID_FILENAME, OCCD_READINESS_FILENAME } from './occd-remote-host-support'
import {
  occdStopFreedTheHost,
  parseOCCdStopOutcome,
  stopOCCdCommand
} from './occd-remote-process-control'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  occdReadinessWaitCommand,
  parseOCCdReadinessWaitOutput
} from './occd-remote-readiness-wait'
import {
  captureOCCdStateSnapshotCommand,
  compareOCCdStateSnapshotCommand,
  occdSnapshotIsUnchanged,
  parseOCCdSnapshotCapture,
  parseOCCdSnapshotRestore,
  probeOCCdStateSnapshotCommand,
  restoreOCCdStateSnapshotCommand
} from '../host-state/occd-state-snapshot'
import {
  newestStateMtimeCommand,
  parseNewestStateMtimeSeconds
} from '../host-state/occd-state-newest-mtime'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { OCCD_STOP_REQUEST_FILENAME } from '../../../shared/occd-stop-request'

const host = getRemoteHostPlatform('linux-x64')
let root = ''
let dataDir = ''
let snapshotDir = ''
const baseDir = (): string => join(root, '.occ-remote')
let versionDir = ''
const launchedPids = new Set<number>()

function sh(command: string): string {
  return execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'occd-shell-'))
  dataDir = join(root, '.occ')
  snapshotDir = join(root, 'snapshots', 'pre-0.2.0+bb01-1000')
  versionDir = join(root, '.occ-remote', 'occd-0.2.0+bb01')
  mkdirSync(join(dataDir, 'profiles', 'p1'), { recursive: true })
  mkdirSync(join(dataDir, 'daemon'), { recursive: true })
  mkdirSync(versionDir, { recursive: true })
  writeFileSync(join(dataDir, 'occ-profile-index.json'), '{"v":"before"}')
  writeFileSync(join(dataDir, 'profiles', 'p1', 'occ-data.json'), '{"repos":"before"}')
  writeFileSync(join(dataDir, 'daemon', 'daemon.sock.token'), 'live-daemon-token')
})

afterEach(() => {
  for (const pid of launchedPids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
  launchedPids.clear()
  rmSync(root, { recursive: true, force: true })
})

async function launchTestRuntime(
  legacyWrapper = false,
  stopRequests = false,
  splitEntry = false
): Promise<{
  runtimePid: number
  recordedPid: number
  terminatedFile: string
}> {
  const terminatedFile = join(versionDir, 'terminated')
  const requestFile = join(versionDir, OCCD_STOP_REQUEST_FILENAME)
  writeFileSync(
    join(versionDir, splitEntry ? 'occd-server.js' : 'occd.js'),
    [
      `const fs = require('node:fs');`,
      `process.on('SIGTERM', () => {`,
      `  fs.writeFileSync(${JSON.stringify(terminatedFile)}, 'terminated');`,
      `  process.exit(0);`,
      `});`,
      ...(stopRequests
        ? [
            `setInterval(() => {`,
            `  if (fs.existsSync(${JSON.stringify(requestFile)})) {`,
            `    fs.unlinkSync(${JSON.stringify(requestFile)});`,
            `    fs.writeFileSync(${JSON.stringify(terminatedFile)}, 'requested');`,
            `    process.exit(0);`,
            `  }`,
            `}, 20);`
          ]
        : []),
      `console.log(JSON.stringify({type: 'occ_server_ready', health: {pid: process.pid${
        stopRequests ? ', stopRequests: 1' : ''
      }}}));`,
      `setTimeout(() => process.exit(1), 10_000);`
    ].join('\n')
  )
  if (splitEntry) {
    writeFileSync(join(versionDir, 'occd.js'), 'require("./occd-server.js")')
  }
  let command = occdLaunchCommand(host, {
    remoteInstallDir: versionDir,
    nodePath: process.execPath,
    fullVersion: '0.2.0+bb01',
    userDataDir: dataDir,
    bindHost: '127.0.0.1',
    port: 0,
    activationRoot: join(dataDir, '.occd-activation-transaction')
  })
  if (legacyWrapper) {
    // A trailing command reproduces legacy macOS waiting-shell behavior on all POSIX shells.
    command = command
      .replace('exec nohup ', 'nohup ')
      .replace('< /dev/null &', '< /dev/null && : &')
  }
  execFileSync('/bin/sh', ['-c', command], { stdio: 'ignore', timeout: 5_000 })
  const recordedPid = Number(readFileSync(join(versionDir, OCCD_PID_FILENAME), 'utf8').trim())
  expect(recordedPid).toBeGreaterThan(1)
  launchedPids.add(recordedPid)
  const readRuntimePid = (): number => {
    const parsed = parseOCCdReadinessOutput(
      readFileSync(join(versionDir, OCCD_READINESS_FILENAME), 'utf8')
    )
    return parsed.state === 'ready' ? (parsed.readiness.health?.pid ?? 0) : 0
  }
  await expect.poll(readRuntimePid, { timeout: 2_000, interval: 20 }).toBeGreaterThan(1)
  const runtimePid = readRuntimePid()
  launchedPids.add(runtimePid)
  return { runtimePid, recordedPid, terminatedFile }
}

function stopTestRuntime(justLaunched = false): ReturnType<typeof parseOCCdStopOutcome> {
  return parseOCCdStopOutcome(
    execFileSync(
      '/bin/sh',
      [
        '-c',
        stopOCCdCommand(host, versionDir, {
          waitSeconds: 3,
          ...(justLaunched ? { justLaunched: true as const } : { nodePath: process.execPath })
        })
      ],
      { encoding: 'utf8', timeout: 5_000 }
    )
  )
}

describe('state snapshot commands, run for real', () => {
  it('detects candidate SQLite migration without modifying current state or the snapshot', () => {
    sh(captureOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
    const archive = readFileSync(join(snapshotDir, 'state.tar'))
    const compare = (): boolean =>
      occdSnapshotIsUnchanged(
        sh(compareOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
      )
    expect(compare()).toBe(true)
    writeFileSync(join(dataDir, 'daemon', 'daemon.sock.token'), 'live-daemon-after-launch')
    expect(compare()).toBe(true)

    const databasePath = join(dataDir, 'profiles', 'p1', 'profile-state.db')
    const candidate = openProfileStateDatabase(databasePath, 'p1')
    try {
      importProfileStateJson(candidate.db, '{"settings":{"theme":"dark"}}')
    } finally {
      candidate.db.close()
    }
    const databaseBytes = readFileSync(databasePath)

    expect(compare()).toBe(false)
    expect(readFileSync(databasePath)).toEqual(databaseBytes)
    expect(readFileSync(join(snapshotDir, 'state.tar'))).toEqual(archive)
    expect(readFileSync(join(dataDir, 'daemon', 'daemon.sock.token'), 'utf8')).toBe(
      'live-daemon-after-launch'
    )
  })

  it('requires an intact comparison snapshot before an older build can restart', () => {
    expect(
      occdSnapshotIsUnchanged(
        sh(compareOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
      )
    ).toBe(false)
    sh(captureOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
    writeFileSync(join(snapshotDir, 'state.tar'), 'not an archive')
    expect(
      occdSnapshotIsUnchanged(
        sh(compareOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
      )
    ).toBe(false)
    expect(readFileSync(join(dataDir, 'profiles', 'p1', 'occ-data.json'), 'utf8')).toBe(
      '{"repos":"before"}'
    )
  })

  it('rejects symlinked profile state that a tar snapshot does not preserve', () => {
    const external = join(root, 'external-profile')
    mkdirSync(external)
    writeFileSync(join(external, 'occ-data.json'), '{"before":true}')
    const profile = join(dataDir, 'profiles', 'linked')
    symlinkSync(external, profile)

    expect(
      parseOCCdSnapshotCapture(
        sh(captureOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
      )
    ).toBe('failed')

    mkdirSync(snapshotDir, { recursive: true })
    execFileSync('tar', ['-C', dataDir, '-cf', join(snapshotDir, 'state.tar'), 'profiles'])
    writeFileSync(join(external, 'occ-data.json'), '{"candidate":true}')
    expect(
      occdSnapshotIsUnchanged(
        sh(compareOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
      )
    ).toBe(false)
    expect(readFileSync(join(external, 'occ-data.json'), 'utf8')).toBe('{"candidate":true}')
  })

  it('captures, then restores state the newer build overwrote', () => {
    expect(
      parseOCCdSnapshotCapture(
        sh(captureOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
      )
    ).toBe('captured')
    expect(sh(probeOCCdStateSnapshotCommand(host, snapshotDir, baseDir())).trim()).toBe('PRESENT')

    writeFileSync(join(dataDir, 'occ-profile-index.json'), '{"v":"migrated"}')
    writeFileSync(join(dataDir, 'profiles', 'p1', 'new-build-only.json'), '{}')

    expect(
      parseOCCdSnapshotRestore(
        sh(restoreOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
      )
    ).toBe('restored')
    expect(readFileSync(join(dataDir, 'occ-profile-index.json'), 'utf8')).toBe('{"v":"before"}')
    // Older builds must not see files introduced by the newer build.
    expect(() => readFileSync(join(dataDir, 'profiles', 'p1', 'new-build-only.json'))).toThrow()
  })

  it('round-trips a quiescent SQLite profile database with its WAL sidecars', () => {
    const profileDirectory = join(dataDir, 'profiles', 'p1')
    const databasePath = join(profileDirectory, 'profile-state.db')
    const opened = openProfileStateDatabase(databasePath, 'p1')
    try {
      importProfileStateJson(
        opened.db,
        JSON.stringify({ settings: { theme: 'dark' }, snapshotMarker: 'before' })
      )
      // Keep the connection open so quiescent WAL/SHM files remain inside the archive boundary.
      expect(existsSync(`${databasePath}-wal`)).toBe(true)
      expect(
        parseOCCdSnapshotCapture(
          sh(captureOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
        )
      ).toBe('captured')
    } finally {
      opened.db.close()
    }

    const changed = openProfileStateDatabase(databasePath, 'p1')
    try {
      importProfileStateJson(
        changed.db,
        JSON.stringify({ settings: { theme: 'light' }, snapshotMarker: 'after' })
      )
    } finally {
      changed.db.close()
    }
    expect(
      parseOCCdSnapshotRestore(
        sh(restoreOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
      )
    ).toBe('restored')

    const restored = openProfileStateDatabase(databasePath, 'p1')
    try {
      expect(JSON.parse(exportProfileStateJson(restored.db))).toEqual({
        settings: { theme: 'dark' },
        snapshotMarker: 'before'
      })
    } finally {
      restored.db.close()
    }
  })

  it('leaves the live daemon runtime dir untouched through capture and restore', () => {
    sh(captureOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
    // Daemon tokens can change during rollback; restoring them would break terminal adoption.
    writeFileSync(join(dataDir, 'daemon', 'daemon.sock.token'), 'token-after-restart')
    sh(restoreOCCdStateSnapshotCommand(host, dataDir, snapshotDir, baseDir()))
    expect(readFileSync(join(dataDir, 'daemon', 'daemon.sock.token'), 'utf8')).toBe(
      'token-after-restart'
    )
  })

  it('reports EMPTY on a data root with nothing to lose, instead of an archive of nothing', () => {
    const emptyRoot = join(root, 'fresh')
    mkdirSync(emptyRoot)
    expect(
      parseOCCdSnapshotCapture(
        sh(captureOCCdStateSnapshotCommand(host, emptyRoot, snapshotDir, baseDir()))
      )
    ).toBe('empty')
    expect(sh(probeOCCdStateSnapshotCommand(host, snapshotDir, baseDir())).trim()).toBe('ABSENT')
  })

  it('reports MISSING rather than claiming a restore it did not perform', () => {
    expect(
      parseOCCdSnapshotRestore(
        sh(restoreOCCdStateSnapshotCommand(host, dataDir, join(root, 'nope'), baseDir()))
      )
    ).toBe('missing')
  })

  it('reads a real mtime for the store', () => {
    const seconds = parseNewestStateMtimeSeconds(
      sh(newestStateMtimeCommand(host, dataDir, baseDir()))
    )
    expect(seconds).toBeGreaterThan(1_600_000_000)
    expect(seconds).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 5)
  })

  it('survives a data root whose path contains a quote and a space', () => {
    const nasty = join(root, `it's a dir`)
    mkdirSync(join(nasty, 'profiles'), { recursive: true })
    writeFileSync(join(nasty, 'occ-profile-index.json'), '{"v":"quoted"}')
    expect(
      parseOCCdSnapshotCapture(
        sh(captureOCCdStateSnapshotCommand(host, nasty, snapshotDir, baseDir()))
      )
    ).toBe('captured')
    expect(
      occdSnapshotIsUnchanged(
        sh(compareOCCdStateSnapshotCommand(host, nasty, snapshotDir, baseDir()))
      )
    ).toBe(true)
    writeFileSync(join(nasty, 'occ-profile-index.json'), '{"v":"changed"}')
    expect(
      occdSnapshotIsUnchanged(
        sh(compareOCCdStateSnapshotCommand(host, nasty, snapshotDir, baseDir()))
      )
    ).toBe(false)
    expect(
      parseOCCdSnapshotRestore(
        sh(restoreOCCdStateSnapshotCommand(host, nasty, snapshotDir, baseDir()))
      )
    ).toBe('restored')
    expect(readFileSync(join(nasty, 'occ-profile-index.json'), 'utf8')).toBe('{"v":"quoted"}')
  })
})

describe('liveness and stop commands, run for real', () => {
  it.each([false, true])(
    'records and stops the runtime PID with split entry %s',
    async (splitEntry) => {
      const { runtimePid, recordedPid, terminatedFile } = await launchTestRuntime(
        false,
        false,
        splitEntry
      )
      expect(recordedPid).toBe(runtimePid)
      expect(parseOCCdLiveness(sh(occdLivenessProbeCommand(host, versionDir)))).toBe('LIVE')
      // Shipped clients recognize only occd.js when checking PID reuse.
      const legacyIdentity = sh(
        `args=$(ps -o args= -p ${recordedPid}); ` +
          `case "$args" in *${quotePosixShell(join(versionDir, 'occd.js'))}*) echo LIVE;; *) echo DEAD;; esac`
      ).trim()
      expect(legacyIdentity).toBe('LIVE')
      expect(stopTestRuntime()).toBe('stopped')
      expect(readFileSync(terminatedFile, 'utf8')).toBe('terminated')
      // kill -0 succeeds for exited, unreaped zombies.
      expect(sh(`ps -o stat= -p ${runtimePid} || true`).trim()).toMatch(/^(?:Z.*)?$/)
      expect(existsSync(join(versionDir, OCCD_PID_FILENAME))).toBe(true)
      expect(stopTestRuntime()).toBe('already-exited')
    }
  )

  it('stops a build that consumes stop requests by request file, not by signal', async () => {
    const { terminatedFile } = await launchTestRuntime(false, true)
    expect(stopTestRuntime()).toBe('stopped')
    expect(readFileSync(terminatedFile, 'utf8')).toBe('requested')
    expect(existsSync(join(versionDir, OCCD_STOP_REQUEST_FILENAME))).toBe(false)
  })

  it('clears a stop request the previous process never consumed before launching', async () => {
    writeFileSync(join(versionDir, OCCD_STOP_REQUEST_FILENAME), '')
    const { runtimePid } = await launchTestRuntime(false, true)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(parseOCCdLiveness(sh(occdLivenessProbeCommand(host, versionDir)))).toBe('LIVE')
    expect(runtimePid).toBeGreaterThan(1)
  })

  it('refuses a legacy wrapper PID both before and after its shell exits', async () => {
    const { runtimePid, recordedPid, terminatedFile } = await launchTestRuntime(true)
    expect(recordedPid).not.toBe(runtimePid)
    const beforeWrapperExit = stopTestRuntime()
    expect(beforeWrapperExit).toBe('unknown')
    expect(occdStopFreedTheHost(beforeWrapperExit)).toBe(false)
    expect(() => process.kill(recordedPid, 0)).not.toThrow()
    expect(() => process.kill(runtimePid, 0)).not.toThrow()

    process.kill(recordedPid, 'SIGTERM')
    await expect
      .poll(() => sh(`ps -o stat= -p ${recordedPid} || true`).trim(), { timeout: 2_000 })
      .toMatch(/^(?:Z.*)?$/)
    const afterWrapperExit = stopTestRuntime()
    expect(afterWrapperExit).toBe('unknown')
    expect(occdStopFreedTheHost(afterWrapperExit)).toBe(false)
    expect(() => process.kill(runtimePid, 0)).not.toThrow()
    expect(existsSync(terminatedFile)).toBe(false)
  })

  it.each(['missing', 'malformed', 'without-health'])(
    'refuses an incumbent with %s readiness proof',
    async (proof) => {
      const { runtimePid, terminatedFile } = await launchTestRuntime()
      const readinessFile = join(versionDir, OCCD_READINESS_FILENAME)
      if (proof === 'missing') {
        rmSync(readinessFile)
      } else {
        writeFileSync(readinessFile, proof === 'malformed' ? '{' : '{"type":"occ_server_ready"}')
      }
      expect(stopTestRuntime()).toBe('unknown')
      expect(() => process.kill(runtimePid, 0)).not.toThrow()
      expect(existsSync(terminatedFile)).toBe(false)
    }
  )

  it('can stop a candidate just launched with exec without readiness', async () => {
    const { runtimePid, recordedPid, terminatedFile } = await launchTestRuntime()
    expect(recordedPid).toBe(runtimePid)
    rmSync(join(versionDir, OCCD_READINESS_FILENAME))
    expect(stopTestRuntime(true)).toBe('stopped')
    expect(readFileSync(terminatedFile, 'utf8')).toBe('terminated')
    expect(sh(`ps -o stat= -p ${runtimePid} || true`).trim()).toMatch(/^(?:Z.*)?$/)
  })

  it.each(['before', 'after'])('refuses a permission-denied probe %s SIGTERM', async (phase) => {
    const { runtimePid, terminatedFile } = await launchTestRuntime()
    const deniedProbe = [
      'term_sent=0; kill() {',
      'if [ "$1" = -TERM ]; then term_sent=1; return 0; fi;',
      `if [ '${phase}' = before ] || [ "$term_sent" = 1 ]; then`,
      'echo "kill: Operation not permitted" >&2; return 1; fi;',
      'command kill "$@"; };'
    ].join(' ')
    const outcome = parseOCCdStopOutcome(
      sh(
        `${deniedProbe} ${stopOCCdCommand(host, versionDir, {
          waitSeconds: 1,
          nodePath: process.execPath
        })}`
      )
    )
    // Delivered SIGTERM can leave host changes underway even without a final answer.
    expect(outcome).toBe(phase === 'before' ? 'unknown' : 'unconfirmed')
    expect(occdStopFreedTheHost(outcome)).toBe(false)
    expect(() => process.kill(runtimePid, 0)).not.toThrow()
    expect(existsSync(terminatedFile)).toBe(false)
  })

  it('reports NEVER_LAUNCHED with no launch artifacts, UNKNOWN with no pid, DEAD for an exited pid', () => {
    rmSync(join(versionDir, OCCD_READINESS_FILENAME), { force: true })
    const neverLaunched = sh(occdLivenessProbeCommand(host, versionDir))
    expect(parseOCCdLiveness(neverLaunched)).toBe('NEVER_LAUNCHED')
    expect(occdLivenessAnswerBlocksGc(neverLaunched)).toBe(false)
    writeFileSync(join(versionDir, OCCD_READINESS_FILENAME), '')
    expect(occdLivenessAnswerBlocksGc(sh(occdLivenessProbeCommand(host, versionDir)))).toBe(true)
    expect(parseOCCdLiveness(sh(occdLivenessProbeCommand(host, versionDir)))).toBe('UNKNOWN')
    writeFileSync(join(versionDir, OCCD_PID_FILENAME), 'not-a-pid')
    expect(parseOCCdLiveness(sh(occdLivenessProbeCommand(host, versionDir)))).toBe('UNKNOWN')
    // This shell child has certainly exited.
    const exited = Number(sh('sh -c "echo $$"').trim())
    writeFileSync(join(versionDir, OCCD_PID_FILENAME), String(exited))
    expect(parseOCCdLiveness(sh(occdLivenessProbeCommand(host, versionDir)))).toBe('DEAD')
  })

  it('reports a permission-denied liveness probe as UNKNOWN in any locale', () => {
    writeFileSync(join(versionDir, OCCD_PID_FILENAME), '4242')
    // Keep the permission branch independent of unrelated host PID reuse.
    const matchingPs =
      'ps() { [ "$#" = 4 ] && [ "$1" = -o ] && [ "$2" = args= ] && ' +
      '[ "$3" = -p ] && [ "$4" = 4242 ] || return 1; ' +
      `printf 'node %s\\n' ${quotePosixShell(join(versionDir, 'occd.js'))}; };`
    const deniedKill =
      'kill() { if [ "$LC_ALL" = C ]; then echo "kill: Operation not permitted" >&2; ' +
      'else echo "kill: Vorgang nicht zulässig" >&2; fi; return 1; };'
    expect(
      parseOCCdLiveness(
        sh(
          `LC_ALL=de_DE.UTF-8; ${matchingPs} ${deniedKill} ${occdLivenessProbeCommand(host, versionDir)}`
        )
      )
    ).toBe('UNKNOWN')
  })

  it('reports a reused PID running something other than this slot as DEAD', () => {
    const stranger = spawn('/bin/sh', ['-c', 'sleep 30'], { stdio: 'ignore' })
    try {
      writeFileSync(join(versionDir, OCCD_PID_FILENAME), String(stranger.pid))
      expect(parseOCCdLiveness(sh(occdLivenessProbeCommand(host, versionDir)))).toBe('DEAD')
    } finally {
      stranger.kill('SIGKILL')
    }
  })

  // Slim Linux images ship no ps; after a reboot the recorded PID often names a new process (#34149).
  it.runIf(process.platform === 'linux')(
    'reads argv from /proc on a host without ps, so a reused PID is DEAD and the slot is LIVE',
    () => {
      const noPs = 'ps() { return 127; };'
      const stranger = spawn('/bin/sh', ['-c', 'sleep 30'], { stdio: 'ignore' })
      const slot = spawn(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 30000)', join(versionDir, 'occd.js')],
        { stdio: 'ignore' }
      )
      try {
        writeFileSync(join(versionDir, OCCD_PID_FILENAME), String(stranger.pid))
        expect(
          parseOCCdLiveness(sh(`${noPs} ${occdLivenessProbeCommand(host, versionDir)}`))
        ).toBe('DEAD')
        writeFileSync(join(versionDir, OCCD_PID_FILENAME), String(slot.pid))
        expect(
          parseOCCdLiveness(sh(`${noPs} ${occdLivenessProbeCommand(host, versionDir)}`))
        ).toBe('LIVE')
      } finally {
        stranger.kill('SIGKILL')
        slot.kill('SIGKILL')
      }
    }
  )

  it.each(['occd.js', 'occd-server.js'])(
    'reports LIVE and stops a running %s even without entry files',
    async (entry) => {
      const child = spawn(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 30000)', join(versionDir, entry)],
        { stdio: 'ignore' }
      )
      try {
        writeFileSync(join(versionDir, OCCD_PID_FILENAME), String(child.pid))
        expect(parseOCCdLiveness(sh(occdLivenessProbeCommand(host, versionDir)))).toBe('LIVE')

        const exited = new Promise<NodeJS.Signals | null>((resolve) =>
          child.once('exit', (_code, signal) => resolve(signal))
        )
        expect(
          parseOCCdStopOutcome(
            sh(stopOCCdCommand(host, versionDir, { waitSeconds: 10, justLaunched: true }))
          )
        ).toBe('stopped')
        expect(await exited).toBe('SIGTERM')
        expect(parseOCCdLiveness(sh(occdLivenessProbeCommand(host, versionDir)))).toBe('DEAD')
      } finally {
        child.kill('SIGKILL')
      }
    }
  )

  // kill -0 alone would keep exited zombies live, blocking stop completion and GC.
  it('reports a zombie as DEAD, not as a running process', () => {
    const child = spawn('/bin/sh', ['-c', 'exit 0'], { stdio: 'ignore' })
    try {
      writeFileSync(join(versionDir, OCCD_PID_FILENAME), String(child.pid))
      // Block Node's reaper until the shell observes the required zombie state.
      sh(
        `attempt=0; while [ "$attempt" -lt 100 ]; do ` +
          `case "$(ps -o stat= -p ${child.pid} 2>/dev/null)" in *Z*) exit 0;; esac; ` +
          `attempt=$((attempt + 1)); sleep 0.01; done; exit 1`
      )
      expect(sh(`ps -o stat= -p ${child.pid} || echo GONE`).trim()).toMatch(/^Z/)
      expect(sh(`kill -0 ${child.pid} 2>/dev/null && echo LIVE || echo DEAD`).trim()).toBe('LIVE')
      expect(parseOCCdLiveness(sh(occdLivenessProbeCommand(host, versionDir)))).toBe('DEAD')
      if (process.platform === 'linux') {
        expect(
          parseOCCdLiveness(
            sh(`ps() { return 127; }; ${occdLivenessProbeCommand(host, versionDir)}`)
          )
        ).toBe('DEAD')
      }
      expect(
        parseOCCdStopOutcome(
          sh(stopOCCdCommand(host, versionDir, { waitSeconds: 1, justLaunched: true }))
        )
      ).toBe('already-exited')
    } finally {
      child.unref()
    }
  })

  it('reports ALREADY_EXITED for a stale pid file rather than signalling a stranger', () => {
    const exited = Number(sh('sh -c "echo $$"').trim())
    writeFileSync(join(versionDir, OCCD_PID_FILENAME), String(exited))
    expect(
      parseOCCdStopOutcome(
        sh(stopOCCdCommand(host, versionDir, { waitSeconds: 1, justLaunched: true }))
      )
    ).toBe('already-exited')
  })

  it('reports NO_PID when the version dir was never launched', () => {
    expect(
      parseOCCdStopOutcome(
        sh(stopOCCdCommand(host, versionDir, { waitSeconds: 1, nodePath: process.execPath }))
      )
    ).toBe('no-pid')
  })
})

describe('host-side readiness wait, run for real', () => {
  const readiness = () => join(versionDir, OCCD_READINESS_FILENAME)
  const line = `${JSON.stringify({ type: 'occ_server_ready', runtimeId: 'r1' })}\n`

  it('returns a finished line without waiting out its bound', () => {
    writeFileSync(readiness(), line)
    const started = Date.now()
    const result = parseOCCdReadinessWaitOutput(
      host,
      sh(occdReadinessWaitCommand(host, versionDir, 10))
    )
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(result).toMatchObject({ state: 'ready', readiness: { runtimeId: 'r1' } })
  })

  it('waits for a line still being written, and answers pending when its bound ends', () => {
    writeFileSync(readiness(), line.slice(0, 10))
    sh(
      `(sleep 1; printf '%s\\n' ${quotePosixShell(line.trimEnd().slice(10))} >> ${quotePosixShell(readiness())}) >/dev/null 2>&1 &`
    )
    expect(
      parseOCCdReadinessWaitOutput(host, sh(occdReadinessWaitCommand(host, versionDir, 10)))
    ).toMatchObject({ state: 'ready' })
    writeFileSync(readiness(), '{"type":"occ_ser')
    expect(
      parseOCCdReadinessWaitOutput(host, sh(occdReadinessWaitCommand(host, versionDir, 1)))
    ).toEqual({ state: 'pending' })
  })

  it('reads a missing file as pending', () => {
    expect(
      parseOCCdReadinessWaitOutput(
        host,
        sh(occdReadinessWaitCommand(host, `${versionDir}-none`, 0))
      )
    ).toEqual({ state: 'pending' })
  })
})
