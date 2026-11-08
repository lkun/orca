import { describe, expect, it } from 'vitest'

import {
  parseOCCdSnapshotCapture,
  parseOCCdSnapshotPresence,
  parseOCCdSnapshotRestore,
  restoreOCCdStateSnapshotCommand
} from './occd-state-snapshot'

import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'

const posix = getRemoteHostPlatform('linux-x64')

const ROOT = '/home/u/.occ'
const SNAP = '/home/u/.occ-remote/occd-state-snapshots/pre-0.2.0+bb01-1000'
const BASE = '/home/u/.occ-remote'

describe('capturing the pre-activation snapshot', () => {
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
})

describe('restoring the snapshot', () => {
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
