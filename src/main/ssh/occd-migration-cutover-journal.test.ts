import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeSecureJsonFileWithinLimit } from '../../shared/bounded-secure-json-file'
import { parseOCCdMigrationSourceCutover } from '../../shared/occd-migration/occd-migration-source-cutover'
import { occdMigrationCutoverFixture as cutover } from './occd-migration-cutover-fixture'
import {
  findOCCdMigrationSourceCutoverForTarget,
  listOCCdMigrationSourceCutovers,
  occdMigrationCutoverJournalDirectory,
  removeOCCdMigrationSourceCutover,
  writeOCCdMigrationSourceCutover
} from './occd-migration-cutover-journal'

let userDataPath: string
beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'occd-cutover-journal-'))
})
afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

const journalPath = (id: string) =>
  join(occdMigrationCutoverJournalDirectory(userDataPath), `${id}.json`)

describe('migration cutover journal sidecar', () => {
  it('round-trips a cutover in an owner-only file', () => {
    writeOCCdMigrationSourceCutover(userDataPath, cutover())
    expect(findOCCdMigrationSourceCutoverForTarget(userDataPath, 'ssh-1')).toEqual(cutover())
    if (process.platform !== 'win32') {
      expect(statSync(journalPath('migration-1')).mode & 0o077).toBe(0)
    }
    removeOCCdMigrationSourceCutover(userDataPath, 'migration-1')
    expect(listOCCdMigrationSourceCutovers(userDataPath)).toEqual([])
  })

  it.each([
    ['corrupt JSON', '{not json'],
    ['a manifest bound to another target', JSON.stringify({ ...cutover(), sshTargetId: 'ssh-2' })],
    ['a tampered manifest', JSON.stringify({ ...cutover(), manifestSha256: 'f'.repeat(64) })],
    ['an unknown version', JSON.stringify({ ...cutover(), version: 2 })]
  ])('fails closed on %s', (_label, contents) => {
    mkdirSync(occdMigrationCutoverJournalDirectory(userDataPath), { recursive: true })
    writeFileSync(journalPath('migration-1'), contents)
    expect(() => listOCCdMigrationSourceCutovers(userDataPath)).toThrow('stays fenced')
  })

  it("reads a newer build's journal that adds an optional field", () => {
    mkdirSync(occdMigrationCutoverJournalDirectory(userDataPath), { recursive: true })
    writeFileSync(journalPath('migration-1'), JSON.stringify({ ...cutover(), addedLater: true }))
    expect(listOCCdMigrationSourceCutovers(userDataPath)).toEqual([cutover()])
  })

  it('serves repeat reads from cache yet sees a file rewritten behind its back', () => {
    writeOCCdMigrationSourceCutover(userDataPath, cutover())
    const first = listOCCdMigrationSourceCutovers(userDataPath)
    expect(listOCCdMigrationSourceCutovers(userDataPath)[0]).toBe(first[0])
    writeFileSync(
      journalPath('migration-1'),
      JSON.stringify({ ...cutover(), phase: 'destination-staged' })
    )
    expect(listOCCdMigrationSourceCutovers(userDataPath)[0]?.phase).toBe('destination-staged')
  })

  it('fails closed on a file whose name disagrees with its migration', () => {
    mkdirSync(occdMigrationCutoverJournalDirectory(userDataPath), { recursive: true })
    writeFileSync(journalPath('other'), JSON.stringify(cutover()))
    expect(() => listOCCdMigrationSourceCutovers(userDataPath)).toThrow('stays fenced')
  })

  it('ignores durable-write temporaries but refuses two journals for one target', () => {
    writeOCCdMigrationSourceCutover(userDataPath, cutover())
    writeFileSync(join(occdMigrationCutoverJournalDirectory(userDataPath), 'x.json.tmp'), '?')
    expect(listOCCdMigrationSourceCutovers(userDataPath)).toHaveLength(1)
    writeOCCdMigrationSourceCutover(userDataPath, cutover('migration-2'))
    expect(() => findOCCdMigrationSourceCutoverForTarget(userDataPath, 'ssh-1')).toThrow(
      'journals name SSH target'
    )
  })

  it('bounds concurrent migrations but rewrites an existing one', () => {
    for (const index of [1, 2, 3, 4]) {
      writeOCCdMigrationSourceCutover(userDataPath, cutover(`m-${index}`, `ssh-${index}`))
    }
    expect(() => writeOCCdMigrationSourceCutover(userDataPath, cutover('m-5', 'ssh-5'))).toThrow(
      'capacity'
    )
    writeOCCdMigrationSourceCutover(userDataPath, {
      ...cutover('m-1', 'ssh-1'),
      phase: 'destination-staged'
    })
    expect(findOCCdMigrationSourceCutoverForTarget(userDataPath, 'ssh-1')?.phase).toBe(
      'destination-staged'
    )
  })

  // Keep legacy SSH journal paths/bytes readable by downgraded desktops.
  it('writes the same path and bytes the SSH journal always wrote', () => {
    writeOCCdMigrationSourceCutover(userDataPath, cutover())
    expect(occdMigrationCutoverJournalDirectory(userDataPath)).toBe(
      join(userDataPath, 'occd-migration-cutovers')
    )
    const reference = join(userDataPath, 'reference.json')
    writeSecureJsonFileWithinLimit(
      reference,
      parseOCCdMigrationSourceCutover(cutover()),
      16 * 1024 * 1024,
      { durable: true }
    )
    expect(readFileSync(journalPath('migration-1'))).toEqual(readFileSync(reference))
  })
})
