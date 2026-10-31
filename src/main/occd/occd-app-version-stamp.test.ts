import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stampOCCdAppVersion } from './occd-host-adapters'

describe('the OCC version a server reports', () => {
  let root: string
  let saved: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'occd-app-version-'))
    saved = process.env.OCC_APP_VERSION
    delete process.env.OCC_APP_VERSION
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    if (saved === undefined) {
      delete process.env.OCC_APP_VERSION
    } else {
      process.env.OCC_APP_VERSION = saved
    }
  })

  it('replaces a version inherited from the OCC that started it', () => {
    process.env.OCC_APP_VERSION = '1.4.300'
    mkdirSync(join(root, 'out'), { recursive: true })
    writeFileSync(join(root, 'out', 'package.json'), JSON.stringify({ version: '1.4.224' }))
    stampOCCdAppVersion(() => root)
    expect(process.env.OCC_APP_VERSION).toBe('1.4.224')
  })

  it('leaves the environment alone when the bundle has no version', () => {
    stampOCCdAppVersion(() => root)
    expect(process.env.OCC_APP_VERSION).toBeUndefined()
    stampOCCdAppVersion(() => {
      throw new Error('occd_install_root_unavailable')
    })
    expect(process.env.OCC_APP_VERSION).toBeUndefined()
  })
})
