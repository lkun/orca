import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireOCCdInstanceLock,
  OCCD_LOCK_FILE_NAME,
  type OCCdInstanceLockHooks
} from './occd-instance-lock'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'occd-unexpected-exit-'))
  roots.push(root)
  return root
}

function onBoot(bootId: string, version = '1.0.0'): OCCdInstanceLockHooks {
  return {
    identity: () => 'uid-1000',
    version: () => version,
    startedAtMs: () => 1_000,
    incarnation: () => ({ linuxStartTicks: '1', bootId }),
    holderIdentity: () => 'matches',
    // The earlier run's pid is gone.
    processIsAlive: () => false,
    machineIdentity: () => 'machine-a',
    dataRootIsOnLocalDisk: () => true
  }
}

/** What a run killed before releasing its lock leaves behind. */
function leaveLockOf(root: string, bootId: string): void {
  const lock = acquireOCCdInstanceLock(root, onBoot(bootId))
  lock.release()
  writeFileSync(join(root, OCCD_LOCK_FILE_NAME), JSON.stringify({ ...lock.record, pid: 424242 }))
}

describe('the previous occd run on a data root', () => {
  it('reports an exit that left its lock behind on this boot', () => {
    const root = makeRoot()
    leaveLockOf(root, 'boot-a')

    const lock = acquireOCCdInstanceLock(root, onBoot('boot-a'))

    expect(lock.previousUnexpectedExit).toMatchObject({ pid: 424242, version: '1.0.0' })
  })

  // Explicit stops, idle exits and update activations all stop occd gracefully, which releases it.
  it('reports nothing after a graceful stop, including one followed by an update', () => {
    const root = makeRoot()
    acquireOCCdInstanceLock(root, onBoot('boot-a')).release()

    expect(acquireOCCdInstanceLock(root, onBoot('boot-a', '1.1.0')).previousUnexpectedExit).toBe(
      null
    )
  })

  it('reports nothing when the host rebooted since that run', () => {
    const root = makeRoot()
    leaveLockOf(root, 'boot-a')

    expect(acquireOCCdInstanceLock(root, onBoot('boot-b')).previousUnexpectedExit).toBe(null)
  })
})
