import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import {
  acquireOCCdInstanceLock,
  OCCD_LOCK_FILE_NAME,
  readOCCdInstanceLockRecord,
  type OCCdInstanceLockHooks,
  type OCCdLockRecord
} from './occd-instance-lock'
import { OCCdInstanceLockError } from './occd-data-root-privacy'
import { occdLockRecoveryPrefix } from './occd-instance-lock-reclaim'

// Inject a contender immediately after canonical-lock rename.
const afterLockRename = vi.hoisted((): { next: (() => void) | null; failNext: boolean } => ({
  next: null,
  failNext: false
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return {
    ...actual,
    renameSync: (from: NodeFs.PathLike, to: NodeFs.PathLike) => {
      if (afterLockRename.failNext && String(from).endsWith('occd.lock')) {
        afterLockRename.failNext = false
        throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
      }
      actual.renameSync(from, to)
      const contender = afterLockRename.next
      if (contender && String(from).endsWith('occd.lock')) {
        afterLockRename.next = null
        contender()
      }
    }
  }
})

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'occd-lock-'))
  roots.push(root)
  return root
}

function hooks(overrides: OCCdInstanceLockHooks = {}): OCCdInstanceLockHooks {
  return {
    identity: () => 'uid-1000',
    version: () => '1.0.0-test',
    startedAtMs: () => 1_000,
    incarnation: () => null,
    holderIdentity: () => 'matches',
    processIsAlive: () => false,
    machineIdentity: () => 'machine-a',
    dataRootIsOnLocalDisk: () => true,
    ...overrides
  }
}

function persistedRecord(overrides: Partial<OCCdLockRecord> = {}): OCCdLockRecord {
  return {
    pid: 424242,
    startedAtMs: 1,
    identity: 'uid-1000',
    version: '1.0.0-test',
    acquiredAt: '2026-01-01T00:00:00.000Z',
    nonce: 'stale',
    ...overrides
  }
}

afterEach(() => {
  afterLockRename.next = null
  afterLockRename.failNext = false
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('acquireOCCdInstanceLock', () => {
  it('publishes a record naming the holder and removes it on release', () => {
    const root = makeRoot()
    const lock = acquireOCCdInstanceLock(root, hooks())
    const record = JSON.parse(readFileSync(join(root, OCCD_LOCK_FILE_NAME), 'utf8'))
    expect(record.pid).toBe(process.pid)
    expect(record.identity).toBe('uid-1000')
    expect(record.version).toBe('1.0.0-test')
    lock.release()
    expect(() => readFileSync(join(root, OCCD_LOCK_FILE_NAME), 'utf8')).toThrow()
  })

  it('refuses a second instance while the holder is alive', () => {
    const root = makeRoot()
    acquireOCCdInstanceLock(root, hooks())
    expect(() => acquireOCCdInstanceLock(root, hooks({ processIsAlive: () => true }))).toThrow(
      OCCdInstanceLockError
    )
    expect(() => acquireOCCdInstanceLock(root, hooks({ processIsAlive: () => true }))).toThrow(
      expect.objectContaining({ code: 'occd_instance_lock_held' })
    )
  })

  it('reclaims the record of a holder that is gone', () => {
    const root = makeRoot()
    writeFileSync(join(root, OCCD_LOCK_FILE_NAME), JSON.stringify(persistedRecord()))
    const lock = acquireOCCdInstanceLock(root, hooks({ processIsAlive: () => false }))
    expect(JSON.parse(readFileSync(lock.path, 'utf8')).pid).toBe(process.pid)
  })

  it('treats a live pid whose start time does not match as a recycled pid, not a holder', () => {
    const root = makeRoot()
    writeFileSync(join(root, OCCD_LOCK_FILE_NAME), JSON.stringify(persistedRecord()))
    const lock = acquireOCCdInstanceLock(
      root,
      hooks({ processIsAlive: () => true, holderIdentity: () => 'differs' })
    )
    expect(JSON.parse(readFileSync(lock.path, 'utf8')).pid).toBe(process.pid)
  })

  it('keeps a live holder whose ticks match though its btime-derived start time drifted', () => {
    const root = makeRoot()
    const incarnation = { linuxStartTicks: '1234', bootId: 'boot-a' }
    writeFileSync(
      join(root, OCCD_LOCK_FILE_NAME),
      JSON.stringify(persistedRecord({ startedAtMs: 1_000, ...incarnation }))
    )
    const drifted = {
      processIsAlive: () => true,
      holderIdentity: undefined,
      startedAtMs: () => 158_000,
      incarnation: () => incarnation
    }
    expect(() => acquireOCCdInstanceLock(root, hooks(drifted))).toThrow(
      expect.objectContaining({ code: 'occd_instance_lock_held' })
    )
    const reused = { ...drifted, incarnation: () => ({ ...incarnation, linuxStartTicks: '9' }) }
    expect(acquireOCCdInstanceLock(root, hooks(reused)).record.nonce).not.toBe('stale')
  })

  // Platform hooks also select privacy checks; Windows temp modes cannot satisfy POSIX permissions.
  describe.runIf(process.platform !== 'win32')(
    'an older Linux record whose wall-clock start time disagrees',
    () => {
      const olderRecord = persistedRecord({
        identity: '1000',
        acquiredAt: '2026-01-01T00:00:00.000Z'
      })
      const liveMismatch = (ownerUid: number | null): OCCdInstanceLockHooks =>
        hooks({
          identity: () => '1000',
          processIsAlive: () => true,
          holderIdentity: undefined,
          startedAtMs: () => 9e9,
          ownerUid: () => ownerUid,
          processName: () => 'postgres',
          platform: 'linux'
        })

      it.each([
        ['the same uid', 1000],
        ['root, which a non-dumpable process also shows as', 0],
        ['an unreadable owner', null]
      ])('stays held when the live PID is owned by %s', (_owner, ownerUid) => {
        const root = makeRoot()
        const lockPath = join(root, OCCD_LOCK_FILE_NAME)
        writeFileSync(lockPath, JSON.stringify(olderRecord))
        let error: unknown
        try {
          acquireOCCdInstanceLock(root, liveMismatch(ownerUid))
        } catch (caught) {
          error = caught
        }
        expect(error).toEqual(expect.objectContaining({ code: 'occd_instance_lock_held' }))
        const message = error instanceof Error ? error.message : ''
        expect(message).toContain('pid 424242')
        expect(message).toContain('"postgres"')
        expect(message).toContain('reused the PID')
        expect(message).toContain(`delete ${lockPath}`)
        expect(readOCCdInstanceLockRecord(lockPath)?.nonce).toBe('stale')
      })

      it('is reclaimed when another non-root uid now owns the PID', () => {
        const root = makeRoot()
        writeFileSync(join(root, OCCD_LOCK_FILE_NAME), JSON.stringify(olderRecord))
        expect(acquireOCCdInstanceLock(root, liveMismatch(1001)).record.nonce).not.toBe('stale')
      })
    }
  )

  it('reads an older lock without an incarnation, and salvages a malformed one', () => {
    const root = makeRoot()
    writeFileSync(
      join(root, OCCD_LOCK_FILE_NAME),
      JSON.stringify(persistedRecord({ linuxStartTicks: undefined }))
    )
    expect(readOCCdInstanceLockRecord(join(root, OCCD_LOCK_FILE_NAME))).not.toHaveProperty(
      'linuxStartTicks'
    )
    writeFileSync(
      join(root, OCCD_LOCK_FILE_NAME),
      JSON.stringify({ ...persistedRecord(), linuxStartTicks: 12, bootId: '' })
    )
    expect(readOCCdInstanceLockRecord(join(root, OCCD_LOCK_FILE_NAME))).toMatchObject({
      nonce: 'stale',
      linuxStartTicks: undefined,
      bootId: undefined
    })
  })

  it('does not displace a successor published between stale inspection and reclaim', () => {
    const root = makeRoot()
    const lockPath = join(root, OCCD_LOCK_FILE_NAME)
    const successor = persistedRecord({ pid: 777, startedAtMs: 2, nonce: 'successor' })
    writeFileSync(lockPath, JSON.stringify(persistedRecord()))
    let raced = false
    const lockHooks = hooks({
      processIsAlive: () => {
        if (!raced) {
          raced = true
          // Replace after liveness inspection but before the reclaiming rename.
          const displacedPath = `${lockPath}.displaced`
          renameSync(lockPath, displacedPath)
          writeFileSync(lockPath, JSON.stringify(successor), { flag: 'wx', mode: 0o600 })
        }
        return false
      }
    })

    expect(() => acquireOCCdInstanceLock(root, lockHooks)).toThrow(
      expect.objectContaining({ code: 'occd_instance_lock_held' })
    )
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).nonce).toBe('successor')
  })

  it('never reclaims a lock held by a different identity, even a dead one', () => {
    const root = makeRoot()
    writeFileSync(
      join(root, OCCD_LOCK_FILE_NAME),
      JSON.stringify(persistedRecord({ identity: 'uid-2000', nonce: 'other' }))
    )
    expect(() => acquireOCCdInstanceLock(root, hooks({ processIsAlive: () => false }))).toThrow(
      expect.objectContaining({ code: 'occd_instance_lock_foreign_identity' })
    )
  })

  it('does not delete a record that a later instance already replaced', () => {
    const root = makeRoot()
    const lock = acquireOCCdInstanceLock(root, hooks())
    writeFileSync(
      lock.path,
      JSON.stringify(persistedRecord({ pid: 777, startedAtMs: 2, nonce: 'successor' }))
    )
    lock.release()
    expect(JSON.parse(readFileSync(lock.path, 'utf8')).nonce).toBe('successor')
  })

  const garbledLocks = [
    ['nothing (a torn write)', ''],
    ['invalid JSON', '{'],
    ['an incomplete record', JSON.stringify({ pid: 424242, identity: 'uid-1000' })],
    ['an invalid pid', JSON.stringify(persistedRecord({ pid: -1 }))],
    ['an invalid start time', JSON.stringify({ ...persistedRecord(), startedAtMs: 'yesterday' })]
  ]

  it.each(garbledLocks)('leaves a lock still being written alone: %s', (_label, contents) => {
    const root = makeRoot()
    writeFileSync(join(root, OCCD_LOCK_FILE_NAME), contents)

    expect(() => acquireOCCdInstanceLock(root, hooks())).toThrow(
      expect.objectContaining({ code: 'occd_instance_lock_held' })
    )
    expect(readFileSync(join(root, OCCD_LOCK_FILE_NAME), 'utf8')).toBe(contents)
  })

  it.each(garbledLocks)('reclaims an abandoned lock containing %s', (_label, contents) => {
    const root = makeRoot()
    const lockPath = join(root, OCCD_LOCK_FILE_NAME)
    writeFileSync(lockPath, contents)
    const longAgo = new Date(Date.now() - 60_000)
    utimesSync(lockPath, longAgo, longAgo)

    const lock = acquireOCCdInstanceLock(root, hooks())
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).nonce).toBe(lock.record.nonce)
    expect(readdirSync(root).sort()).toEqual([OCCD_LOCK_FILE_NAME])
  })

  it('fails closed when the existing lock is not a regular file', () => {
    const root = makeRoot()
    mkdirSync(join(root, OCCD_LOCK_FILE_NAME))

    expect(() => acquireOCCdInstanceLock(root, hooks())).toThrow(
      expect.objectContaining({ code: 'occd_instance_lock_unreadable' })
    )
  })

  it('fails closed without reading an oversized lock into memory', () => {
    const root = makeRoot()
    const lockPath = join(root, OCCD_LOCK_FILE_NAME)
    writeFileSync(lockPath, 'x'.repeat(64 * 1024 + 1))

    expect(() => acquireOCCdInstanceLock(root, hooks())).toThrow(
      expect.objectContaining({ code: 'occd_instance_lock_unreadable' })
    )
    expect(statSync(lockPath).size).toBe(64 * 1024 + 1)
  })

  it.runIf(process.platform !== 'win32')(
    'tightens a group/world-accessible data root rather than refusing when it can',
    () => {
      const root = makeRoot()
      chmodSync(root, 0o755)
      acquireOCCdInstanceLock(root, hooks())
      expect(statSync(root).mode & 0o777).toBe(0o700)
    }
  )

  // Root owns /tmp, so this wrong-owner fixture requires a non-root caller.
  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
    'refuses a data root owned by another uid',
    () => {
      const root = makeRoot()
      expect(() => acquireOCCdInstanceLock('/tmp', hooks())).toThrow(
        expect.objectContaining({ code: 'occd_data_root_wrong_owner' })
      )
      expect(acquireOCCdInstanceLock(root, hooks()).record.identity).toBe('uid-1000')
    }
  )

  it('restricts a Windows data root by ACL, and refuses when the ACL cannot be applied', () => {
    const root = makeRoot()
    const restricted: string[] = []
    const windows = (applied: boolean) =>
      hooks({
        platform: 'win32',
        restrictWindowsDataRoot: (path) => {
          restricted.push(path)
          return applied
        }
      })
    expect(() => acquireOCCdInstanceLock(root, windows(false))).toThrow(
      expect.objectContaining({ code: 'occd_data_root_shared' })
    )
    expect(() => readFileSync(join(root, OCCD_LOCK_FILE_NAME))).toThrow()
    expect(acquireOCCdInstanceLock(root, windows(true)).record.pid).toBe(process.pid)
    expect(restricted).toEqual([root, root])
  })

  it.runIf(process.platform === 'win32')(
    'records a real creation time and leaves a really restricted data root on Windows',
    () => {
      const root = makeRoot()
      const lock = acquireOCCdInstanceLock(root, { identity: () => 'uid-1000' })
      expect(lock.record.startedAtMs).toEqual(expect.any(Number))
      expect(
        Math.abs(lock.record.startedAtMs! - (Date.now() - process.uptime() * 1000))
      ).toBeLessThan(5_000)
      lock.release()
    }
  )

  it('makes the desktop app and occd refuse each other on one profile', () => {
    const root = makeRoot()
    const desktop = acquireOCCdInstanceLock(root, hooks({ role: 'desktop' }))
    expect(JSON.parse(readFileSync(desktop.path, 'utf8')).role).toBe('desktop')
    expect(() => acquireOCCdInstanceLock(root, hooks({ processIsAlive: () => true }))).toThrow(
      expect.objectContaining({
        code: 'occd_instance_lock_held',
        message: expect.stringContaining('The OCC desktop app')
      })
    )
    desktop.release()
    const occd = acquireOCCdInstanceLock(root, hooks())
    expect(() =>
      acquireOCCdInstanceLock(root, hooks({ role: 'desktop', processIsAlive: () => true }))
    ).toThrow(
      expect.objectContaining({
        code: 'occd_instance_lock_held',
        message: expect.stringContaining('Another occd')
      })
    )
    occd.release()
  })

  it('lets a desktop reclaim a crashed desktop record whose PID was reused', () => {
    const root = makeRoot()
    writeFileSync(
      join(root, OCCD_LOCK_FILE_NAME),
      JSON.stringify(persistedRecord({ role: 'desktop', startedAtMs: null }))
    )
    // Electron’s lock proves desktop absence even when missing start time cannot reject PID reuse.
    const lock = acquireOCCdInstanceLock(
      root,
      hooks({ role: 'desktop', processIsAlive: () => true })
    )
    expect(JSON.parse(readFileSync(lock.path, 'utf8')).nonce).toBe(lock.record.nonce)
    lock.release()
  })

  it('never judges a holder on another machine by a PID this machine issued', () => {
    const root = makeRoot()
    const lockPath = join(root, OCCD_LOCK_FILE_NAME)
    const remote = persistedRecord({ nonce: 'machine-b', machineIdentity: 'machine-b' })
    writeFileSync(lockPath, JSON.stringify(remote))
    for (const role of ['occd', 'desktop'] as const) {
      expect(() => acquireOCCdInstanceLock(root, hooks({ role }))).toThrow(
        expect.objectContaining({
          code: 'occd_instance_lock_holder_unverifiable',
          message: expect.stringContaining('from another machine')
        })
      )
    }
    expect(readOCCdInstanceLockRecord(lockPath)?.nonce).toBe('machine-b')
    expect(readdirSync(root)).toEqual([OCCD_LOCK_FILE_NAME])

    writeFileSync(lockPath, JSON.stringify({ ...remote, machineIdentity: 'machine-a' }))
    const lock = acquireOCCdInstanceLock(root, hooks())
    expect(readOCCdInstanceLockRecord(lockPath)).toMatchObject({
      nonce: lock.record.nonce,
      machineIdentity: 'machine-a'
    })
  })

  describe.skipIf(process.platform === 'win32')(
    'a machine cloned with this machine-id (#32918)',
    () => {
      const HOUR = 3_600_000
      const sharedLinux = (overrides: OCCdInstanceLockHooks = {}) =>
        hooks({
          platform: 'linux',
          dataRootIsOnLocalDisk: () => false,
          incarnation: () => ({ linuxStartTicks: '1', bootId: 'boot-self' }),
          now: () => new Date(),
          bootStartedAtMs: () => Date.now() - HOUR,
          ...overrides
        })
      const writeLock = (root: string, writtenAtMs: number, host: string): string => {
        const lockPath = join(root, OCCD_LOCK_FILE_NAME)
        const acquiredAt = new Date(writtenAtMs).toISOString()
        const clone = { machineIdentity: 'machine-a', bootId: 'boot-clone', host, acquiredAt }
        writeFileSync(lockPath, JSON.stringify(persistedRecord(clone)))
        utimesSync(lockPath, writtenAtMs / 1000, writtenAtMs / 1000)
        return lockPath
      }

      it.each(['dev-clone', hostname()])(
        'refuses its live lock, written since this boot, whatever its hostname (%s)',
        (host) => {
          const root = makeRoot()
          const lockPath = writeLock(root, Date.now(), host)
          expect(() => acquireOCCdInstanceLock(root, sharedLinux())).toThrow(
            expect.objectContaining({
              code: 'occd_instance_lock_holder_unverifiable',
              message: expect.stringContaining('systemd-machine-id-setup')
            })
          )
          expect(readOCCdInstanceLockRecord(lockPath)?.nonce).toBe('stale')
        }
      )

      it('reclaims a lock this machine wrote before its boot, though since renamed', () => {
        const root = makeRoot()
        writeLock(root, Date.now() - 2 * HOUR, 'old-name')
        acquireOCCdInstanceLock(root, sharedLinux()).release()
      })

      it('reclaims a crashed clone’s lock once its heartbeat is stale', () => {
        const root = makeRoot()
        writeLock(root, Date.now() - 10 * 60_000, 'dev-clone')
        acquireOCCdInstanceLock(root, sharedLinux()).release()
      })

      it('reclaims on a local disk, which only one machine can use', () => {
        const root = makeRoot()
        writeLock(root, Date.now(), 'dev-clone')
        acquireOCCdInstanceLock(root, sharedLinux({ dataRootIsOnLocalDisk: () => true })).release()
      })

      it('keeps the lock’s mtime fresh while held', () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
        try {
          const root = makeRoot()
          const lock = acquireOCCdInstanceLock(root, hooks())
          const before = statSync(lock.path).mtimeMs
          vi.advanceTimersByTime(2 * 60_000)
          expect(statSync(lock.path).mtimeMs).toBeGreaterThan(before)
          lock.release()
        } finally {
          vi.useRealTimers()
        }
      })
    }
  )

  it('never lets a confirmed reclaim take a lock another machine id holds', () => {
    const root = makeRoot()
    const lockPath = join(root, OCCD_LOCK_FILE_NAME)
    writeFileSync(lockPath, JSON.stringify(persistedRecord({ machineIdentity: 'machine-b' })))
    expect(() => acquireOCCdInstanceLock(root, hooks({ reclaimConfirmed: () => true }))).toThrow(
      expect.objectContaining({ code: 'occd_instance_lock_holder_unverifiable' })
    )
    expect(readOCCdInstanceLockRecord(lockPath)?.nonce).toBe('stale')
  })

  it('reclaims a record naming no machine only when it is provably from this one', () => {
    const root = makeRoot()
    const lockPath = join(root, OCCD_LOCK_FILE_NAME)
    writeFileSync(lockPath, JSON.stringify(persistedRecord({ bootId: 'boot-1' })))
    const shared = { dataRootIsOnLocalDisk: () => false }
    expect(() => acquireOCCdInstanceLock(root, hooks(shared))).toThrow(
      expect.objectContaining({ code: 'occd_instance_lock_holder_unverifiable' })
    )
    expect(() =>
      acquireOCCdInstanceLock(root, hooks({ ...shared, machineIdentity: () => null }))
    ).toThrow(expect.objectContaining({ code: 'occd_instance_lock_holder_unverifiable' }))
    expect(readOCCdInstanceLockRecord(lockPath)?.nonce).toBe('stale')

    const sameBoot = hooks({
      ...shared,
      incarnation: () => ({ linuxStartTicks: '1', bootId: 'boot-1' })
    })
    acquireOCCdInstanceLock(root, sameBoot).release()
    writeFileSync(lockPath, JSON.stringify(persistedRecord()))
    expect(acquireOCCdInstanceLock(root, hooks()).record.machineIdentity).toBe('machine-a')
  })

  it('admits one owner when reclaimers of the same stale lock interleave', () => {
    const root = makeRoot()
    const lockPath = join(root, OCCD_LOCK_FILE_NAME)
    writeFileSync(lockPath, JSON.stringify(persistedRecord()))
    const owners: { record: OCCdLockRecord }[] = []
    const failures: unknown[] = []
    const attempt = (lockHooks: OCCdInstanceLockHooks): void => {
      try {
        owners.push(acquireOCCdInstanceLock(root, lockHooks))
      } catch (error) {
        failures.push(error)
      }
    }
    let raced = false
    // B replaces A’s inspected stale lock; C races the vacant path if B’s live lock is renamed.
    attempt(
      hooks({
        processIsAlive: () => {
          if (!raced) {
            raced = true
            attempt(hooks())
            afterLockRename.next = () => attempt(hooks())
          }
          return false
        }
      })
    )

    expect(owners).toHaveLength(1)
    expect(readOCCdInstanceLockRecord(lockPath)?.nonce).toBe(owners[0]?.record.nonce)
    expect(failures).toEqual([expect.objectContaining({ code: 'occd_instance_lock_held' })])
    expect(readdirSync(root)).toEqual([OCCD_LOCK_FILE_NAME])
  })

  it('takes a new recovery generation only once every earlier owner provably exited', () => {
    const root = makeRoot()
    const lockPath = join(root, OCCD_LOCK_FILE_NAME)
    const stale = JSON.stringify(persistedRecord({ machineIdentity: 'machine-a' }))
    const generation = (n: number): string => `${occdLockRecoveryPrefix(lockPath, stale)}${n}`
    const leaveRecovery = (n: number, owner: string | null): void => {
      mkdirSync(generation(n))
      if (owner !== null) {
        writeFileSync(join(generation(n), 'owner'), owner)
      }
    }
    const reclaimer = (overrides: Partial<OCCdLockRecord>): string =>
      JSON.stringify(persistedRecord({ pid: 5150, nonce: 'reclaimer', ...overrides }))
    const refused = expect.objectContaining({ message: expect.stringContaining('is reclaiming') })
    // A paused reclaimer remains live regardless of elapsed time.
    const paused = hooks({ processIsAlive: (pid) => pid === 5150 })
    const reset = (): void => {
      for (const entry of readdirSync(root)) {
        rmSync(join(root, entry), { recursive: true, force: true })
      }
      writeFileSync(lockPath, stale)
    }

    for (const owner of [
      reclaimer({ machineIdentity: 'machine-a' }),
      reclaimer({ pid: 6160, machineIdentity: 'machine-b' }),
      'not a record'
    ]) {
      reset()
      leaveRecovery(0, owner)
      expect(() => acquireOCCdInstanceLock(root, paused)).toThrow(refused)
      expect(readOCCdInstanceLockRecord(lockPath)?.nonce).toBe('stale')
      expect(readFileSync(join(generation(0), 'owner'), 'utf8')).toBe(owner)
    }
    reset()
    mkdirSync(join(generation(0), 'owner'), { recursive: true })
    expect(() => acquireOCCdInstanceLock(root, paused)).toThrow(refused)
    reset()
    leaveRecovery(0, reclaimer({ pid: 6160 }))
    expect(() =>
      acquireOCCdInstanceLock(root, hooks({ ...paused, dataRootIsOnLocalDisk: () => false }))
    ).toThrow(refused)

    for (const owner of [reclaimer({ pid: 6160, machineIdentity: 'machine-a' }), null]) {
      reset()
      leaveRecovery(0, owner)
      const lock = acquireOCCdInstanceLock(root, paused)
      expect(readOCCdInstanceLockRecord(lockPath)?.nonce).toBe(lock.record.nonce)
      expect(readdirSync(root)).toEqual([OCCD_LOCK_FILE_NAME])
      lock.release()
    }
  })

  it('never reuses a generation a failed recovery let go of', () => {
    const root = makeRoot()
    const lockPath = join(root, OCCD_LOCK_FILE_NAME)
    const stale = JSON.stringify(persistedRecord({ machineIdentity: 'machine-a' }))
    const generation = (n: number): string => `${occdLockRecoveryPrefix(lockPath, stale)}${n}`
    writeFileSync(lockPath, stale)
    afterLockRename.failNext = true
    expect(() => acquireOCCdInstanceLock(root, hooks())).toThrow(
      expect.objectContaining({ code: 'occd_instance_lock_held' })
    )
    expect(readdirSync(generation(0)).sort()).toEqual(['owner', 'released'])

    const lock = acquireOCCdInstanceLock(
      root,
      hooks({ processIsAlive: (pid) => pid === process.pid })
    )
    expect(readOCCdInstanceLockRecord(lockPath)?.nonce).toBe(lock.record.nonce)
    expect(readdirSync(root)).toEqual([OCCD_LOCK_FILE_NAME])
  })

  it('never displaces a reclaimer that broke the same dead recovery owner first', () => {
    const root = makeRoot()
    const lockPath = join(root, OCCD_LOCK_FILE_NAME)
    const stale = JSON.stringify(persistedRecord({ machineIdentity: 'machine-a' }))
    const generation = (n: number): string => `${occdLockRecoveryPrefix(lockPath, stale)}${n}`
    writeFileSync(lockPath, stale)
    mkdirSync(generation(0))
    const dead = JSON.stringify(persistedRecord({ pid: 6160, machineIdentity: 'machine-a' }))
    writeFileSync(join(generation(0), 'owner'), dead)
    const live = JSON.stringify(persistedRecord({ pid: 5150, machineIdentity: 'machine-a' }))
    let raced = false
    const racing = hooks({
      processIsAlive: (pid) => {
        if (!raced && pid === 6160) {
          raced = true
          mkdirSync(generation(1))
          writeFileSync(join(generation(1), 'owner'), live)
        }
        return pid === 5150
      }
    })
    const refused = expect.objectContaining({ message: expect.stringContaining('is reclaiming') })
    expect(() => acquireOCCdInstanceLock(root, racing)).toThrow(refused)
    expect(() =>
      acquireOCCdInstanceLock(root, hooks({ processIsAlive: (pid) => pid === 5150 }))
    ).toThrow(refused)
    expect(readFileSync(join(generation(1), 'owner'), 'utf8')).toBe(live)
    expect(readFileSync(join(generation(0), 'owner'), 'utf8')).toBe(dead)
    expect(readOCCdInstanceLockRecord(lockPath)?.nonce).toBe('stale')
    expect(readdirSync(root)).toHaveLength(3)
  })

  it.runIf(process.platform !== 'win32')(
    "leaves the desktop profile's permissions as they were",
    () => {
      const root = makeRoot()
      chmodSync(root, 0o755)
      const restricted: string[] = []
      acquireOCCdInstanceLock(root, hooks({ role: 'desktop' })).release()
      acquireOCCdInstanceLock(
        root,
        hooks({
          role: 'desktop',
          platform: 'win32',
          restrictWindowsDataRoot: (path) => restricted.push(path) > 0
        })
      ).release()
      expect(restricted).toEqual([])
      expect(statSync(root).mode & 0o777).toBe(0o755)
    }
  )
})
