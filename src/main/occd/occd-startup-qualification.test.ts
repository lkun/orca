import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const artifacts = vi.hoisted(() => ({ files: ['occd-server.js', 'daemon-entry.js'] }))
vi.mock('./occd-artifact-identity', () => ({
  listOCCdArtifactFilenames: async () => artifacts.files
}))

import {
  consumeOCCdStartupQualification,
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

  it('consumes a matching marker once, so a launch that dies before readiness re-qualifies', async () => {
    await recordOCCdStartupQualification(slot, 'key-1')

    expect(await consumeOCCdStartupQualification(slot, 'key-1')).toBe(true)
    expect(await consumeOCCdStartupQualification(slot, 'key-1')).toBe(false)
  })
})
