import { describe, expect, it } from 'vitest'

import {
  captureOCCdStateSnapshotCommand,
  clearOCCdStateSnapshotMembersCommand,
  compareOCCdStateSnapshotCommand,
  occdSnapshotDirName,
  parseOCCdSnapshotCapture,
  parseOCCdSnapshotPresence,
  parseOCCdSnapshotRestore,
  probeOCCdStateSnapshotCommand,
  restoreOCCdStateSnapshotCommand,
  OCCD_STATE_MUTATION_DEADLINE_SECONDS
} from './occd-state-snapshot'
import { newestStateMtimeCommand, parseNewestStateMtimeSeconds } from './occd-state-newest-mtime'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { OCCD_SNAPSHOT_EXCLUDED, OCCD_SNAPSHOT_MEMBERS } from './occd-state-snapshot-members'

const posix = getRemoteHostPlatform('linux-x64')
const windows = getRemoteHostPlatform('win32-x64')
const ROOT = '/home/u/.occ'
const SNAP = '/home/u/.occ-remote/occd-state-snapshots/pre-0.2.0+bb01-1000'
const BASE = '/home/u/.occ-remote'

function memberLists(command: string): string[] {
  return [...command.matchAll(/for m in ([^;]+);/g)].map((match) => match[1])
}

function innerScript(command: string): string {
  return command.replaceAll(`'\\''`, `'`)
}

describe('capturing the pre-activation snapshot', () => {
  it('captures the profile state a rollback needs', () => {
    expect(memberLists(captureOCCdStateSnapshotCommand(posix, ROOT, SNAP, BASE))).toEqual([
      OCCD_SNAPSHOT_MEMBERS.join(' ')
    ])
  })

  // Restoring daemon sockets, PID or auth tokens would break adoption of terminals surviving restart.
  it.each(OCCD_SNAPSHOT_EXCLUDED)('never captures, removes or restores over %s', (excluded) => {
    const commands = [
      captureOCCdStateSnapshotCommand(posix, ROOT, SNAP, BASE),
      restoreOCCdStateSnapshotCommand(posix, ROOT, SNAP, BASE),
      clearOCCdStateSnapshotMembersCommand(posix, ROOT, BASE),
      compareOCCdStateSnapshotCommand(posix, ROOT, SNAP, BASE)
    ]
    for (const list of commands.flatMap(memberLists)) {
      expect(list.split(' ')).not.toContain(excluded)
    }
  })

  it('writes the archive under a temp name and renames, so a killed deploy leaves no torn tar', () => {
    const command = captureOCCdStateSnapshotCommand(posix, ROOT, SNAP, BASE)
    expect(command).toContain('.partial')
    expect(command.indexOf('tar -C')).toBeLessThan(command.indexOf('mv '))
  })

  it.each([
    ['CAPTURED', 'captured'],
    ['EMPTY', 'empty'],
    ['tar: broken', 'failed'],
    ['', 'failed'],
    // Gateways may append shell job notices after a valid verdict (#30491).
    ['CAPTURED\r\nsh: line 1:  2468 Terminated   ( while sleep 60 ... )\n', 'captured'],
    ['FAILED\nCAPTURED-looking noise', 'failed']
  ])('parses %j as %s', (output, expected) => {
    expect(parseOCCdSnapshotCapture(output)).toBe(expected)
  })

  it('keys the snapshot dir on both version and time, so a retry cannot overwrite one', () => {
    expect(occdSnapshotDirName('0.2.0+bb01', 1000)).not.toBe(
      occdSnapshotDirName('0.2.0+bb01', 2000)
    )
  })
})

describe('the host-side guard around every state mutation', () => {
  it.each([
    ['capture', () => captureOCCdStateSnapshotCommand(posix, ROOT, SNAP, BASE)],
    ['restore', () => restoreOCCdStateSnapshotCommand(posix, ROOT, SNAP, BASE)],
    ['clear', () => clearOCCdStateSnapshotMembersCommand(posix, ROOT, BASE)]
  ])('%s runs under the host lock and a host-enforced deadline', (_label, build) => {
    const command = build()
    expect(command).toContain(
      `occ_deadline="timeout -s KILL ${OCCD_STATE_MUTATION_DEADLINE_SECONDS}"`
    )
    expect(command).toContain('occ_state_group $occ_deadline sh -c')
    expect(innerScript(command)).toContain(`lock='${BASE}/occd-state-mutation.lock'`)
    expect(command).toContain('echo STATE_MUTATION_DEADLINE')
  })
})

describe('restoring the snapshot', () => {
  it('proves the archive extracts before clearing the live members', () => {
    const command = innerScript(restoreOCCdStateSnapshotCommand(posix, ROOT, SNAP, BASE))
    const extract = command.indexOf('tar -C "$stage" -xf "$archive"')
    expect(extract).toBeGreaterThan(-1)
    expect(extract).toBeLessThan(command.indexOf('rm -rf "$root/$m"'))
  })

  it('reports a missing archive instead of extracting nothing and claiming success', () => {
    expect(restoreOCCdStateSnapshotCommand(posix, ROOT, SNAP, BASE)).toContain('echo MISSING')
    expect(parseOCCdSnapshotRestore('MISSING')).toBe('missing')
    expect(parseOCCdSnapshotRestore('RESTORED')).toBe('restored')
    expect(parseOCCdSnapshotRestore('FAILED')).toBe('failed')
    expect(parseOCCdSnapshotRestore('RESTORED\nsh: line 1: 13 Terminated')).toBe('restored')
  })

  it.each([
    ['PRESENT', 'present'],
    ['ABSENT', 'absent'],
    ['', 'unverifiable'],
    ['bash: tar: command not found', 'unverifiable']
  ])('reads snapshot presence %j as %s, never treating silence as absence', (out, expected) => {
    expect(parseOCCdSnapshotPresence(out)).toBe(expected)
  })
})

describe('detecting writes since activation', () => {
  it.each([
    ['1700000000', 1_700_000_000],
    ['UNKNOWN', null],
    ['', null]
  ])('parses %s', (output, expected) => {
    expect(parseNewestStateMtimeSeconds(output)).toBe(expected)
  })

  it('looks at the same members the snapshot covers', () => {
    const command = newestStateMtimeCommand(posix, ROOT, BASE)
    for (const member of OCCD_SNAPSHOT_MEMBERS) {
      expect(command).toContain(`'${member}'`)
    }
  })
})

describe('Windows hosts', () => {
  const BASE = 'C:/Users/u/.occ-remote'
  it.each([
    [
      'capture',
      'snapshot-capture',
      (base: string) => captureOCCdStateSnapshotCommand(windows, ROOT, SNAP, base)
    ],
    [
      'restore',
      'snapshot-restore',
      (base: string) => restoreOCCdStateSnapshotCommand(windows, ROOT, SNAP, base)
    ],
    [
      'clear',
      'snapshot-clear',
      (base: string) => clearOCCdStateSnapshotMembersCommand(windows, ROOT, base)
    ],
    [
      'presence',
      'snapshot-probe',
      (base: string) => probeOCCdStateSnapshotCommand(windows, SNAP, base)
    ],
    [
      'compare',
      'snapshot-compare',
      (base: string) => compareOCCdStateSnapshotCommand(windows, ROOT, SNAP, base)
    ],
    ['mtime', 'state-newest-mtime', (base: string) => newestStateMtimeCommand(windows, ROOT, base)]
  ])('%s runs the host script op %s with node.exe, never a POSIX command', (_label, op, build) => {
    const command = build(BASE)
    expect(command).toContain(` ${op} `)
    expect(command).toMatch(/^C:\\Users\\u\\\.occ-remote\\runtimes\\node-[0-9a-f]+\\node\.exe /u)
    expect(command).not.toMatch(/tar |find |diff |EncodedCommand|powershell/u)
  })
})
