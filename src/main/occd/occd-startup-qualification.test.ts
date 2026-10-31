import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OCCD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/occd-managed-launch-env'

const artifacts = vi.hoisted(() => ({ files: ['occd-server.js', 'daemon-entry.js'] }))
vi.mock('./occd-artifact-identity', () => ({
  listOCCdArtifactFilenames: async () => artifacts.files
}))

import {
  consumeOCCdStartupQualification,
  discardOCCdStartupQualification,
  isQualifiableOCCdSlot,
  OCCD_STARTUP_QUALIFIED_FILENAME,
  occdStartupQualificationKey,
  recordOCCdStartupQualification
} from './occd-startup-qualification'

let slot: string

beforeEach(() => {
  slot = mkdtempSync(join(tmpdir(), 'occd-qualified-'))
  for (const name of artifacts.files) {
    writeFileSync(join(slot, name), `${name} bytes`)
  }
})

afterEach(() => {
  rmSync(slot, { recursive: true, force: true })
})

describe('occd startup qualification', () => {
  it('keys on the artifact version and on every installed file staying the same file', async () => {
    const key = await occdStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa')

    expect(await occdStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa')).toBe(key)
    expect(await occdStartupQualificationKey(slot, '0.2.0+aaaaaaaaaaaa')).not.toBe(key)
    rmSync(join(slot, 'daemon-entry.js'))
    writeFileSync(join(slot, 'daemon-entry.js'), 'replaced')
    expect(await occdStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa')).not.toBe(key)
  })

  it('names the runtime, node version, libc and kernel in the key', async () => {
    const key = JSON.parse(await occdStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa'))

    expect(Object.keys(key)).toEqual(
      expect.arrayContaining(['runtime', 'node', 'execPath', 'abi', 'kernel', 'files'])
    )
    expect(key.execPath).toBe(process.execPath)
    expect(key.abi).toHaveProperty('glibcVersion')
  })

  it.each(['NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'TMPDIR'])(
    're-qualifies when the launch environment changes %s',
    async (name) => {
      const env = { NODE_OPTIONS: '', LD_PRELOAD: '', LD_LIBRARY_PATH: '', TMPDIR: '/tmp' }
      const key = await occdStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa', env)

      expect(await occdStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa', { ...env })).toBe(key)
      expect(
        await occdStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa', {
          ...env,
          [name]: 'changed'
        })
      ).not.toBe(key)
      expect(
        await occdStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa', {
          ...env,
          [name]: undefined
        })
      ).not.toBe(key)
    }
  )

  it('never matches a marker written under the older schema', async () => {
    const key = await occdStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa')
    await recordOCCdStartupQualification(slot, JSON.stringify({ ...JSON.parse(key), schema: 1 }))

    expect(await consumeOCCdStartupQualification(slot, key)).toBe(false)
  })

  it('fails the key closed when an installed file is missing', async () => {
    rmSync(join(slot, 'daemon-entry.js'))

    await expect(occdStartupQualificationKey(slot, '0.1.0+aaaaaaaaaaaa')).rejects.toThrow()
  })

  it('consumes a matching marker once, so a launch that dies before readiness re-qualifies', async () => {
    await recordOCCdStartupQualification(slot, 'key-1')

    expect(await consumeOCCdStartupQualification(slot, 'key-1')).toBe(true)
    expect(await consumeOCCdStartupQualification(slot, 'key-1')).toBe(false)
  })

  it('keeps qualifying on a different key, a missing marker or a torn one', async () => {
    expect(await consumeOCCdStartupQualification(slot, 'key-1')).toBe(false)
    await recordOCCdStartupQualification(slot, 'key-2')
    expect(await consumeOCCdStartupQualification(slot, 'key-1')).toBe(false)
    writeFileSync(join(slot, OCCD_STARTUP_QUALIFIED_FILENAME), 'key-')
    expect(await consumeOCCdStartupQualification(slot, 'key-1')).toBe(false)
  })

  it('writes the marker whole through a temp file and leaves no temp behind', async () => {
    await recordOCCdStartupQualification(slot, 'key-1')

    expect(readFileSync(join(slot, OCCD_STARTUP_QUALIFIED_FILENAME), 'utf8')).toBe('key-1')
    expect(readdirSync(slot).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('voids a marker on demand, and is silent when there is none', async () => {
    await recordOCCdStartupQualification(slot, 'key-1')

    await discardOCCdStartupQualification(slot)
    await discardOCCdStartupQualification(slot)

    expect(await consumeOCCdStartupQualification(slot, 'key-1')).toBe(false)
  })

  it('qualifies only managed slots outside the app resources', () => {
    const managed = { [OCCD_MANAGED_ACTIVATION_ROOT_ENV]: '/home/u/.occ-remote' }
    const resources = join(slot, 'OCC.app', 'Contents', 'Resources')

    expect(isQualifiableOCCdSlot(join(slot, 'occd-0.1.0+a'), managed, resources)).toBe(true)
    expect(isQualifiableOCCdSlot(join(slot, 'occd-0.1.0+a'), managed, undefined)).toBe(true)
    expect(isQualifiableOCCdSlot(join(slot, 'occd-0.1.0+a'), {}, undefined)).toBe(false)
    expect(isQualifiableOCCdSlot(join(resources, 'occd'), managed, resources)).toBe(false)
    expect(isQualifiableOCCdSlot(resources, managed, resources)).toBe(false)
  })

  it('fails open when the slot cannot be written', async () => {
    await expect(
      recordOCCdStartupQualification(join(slot, 'missing-dir'), 'key-1')
    ).resolves.toBeUndefined()
  })
})
