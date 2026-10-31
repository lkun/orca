import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { occdDataRootIsOnLocalDisk } from './occd-data-root-locality'

describe('occdDataRootIsOnLocalDisk', () => {
  it.runIf(process.platform === 'linux' || process.platform === 'darwin')(
    'recognises a local temp directory, and refuses a path it cannot inspect',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'occd-locality-'))
      try {
        expect(occdDataRootIsOnLocalDisk(root)).toBe(true)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
      expect(occdDataRootIsOnLocalDisk(join(root, 'missing'))).toBe(false)
    }
  )

  it('treats a Windows UNC data root as reachable from other machines', () => {
    expect(occdDataRootIsOnLocalDisk('\\\\filer\\home\\occ', 'win32')).toBe(false)
    expect(occdDataRootIsOnLocalDisk('\\\\?\\UNC\\filer\\home\\occ', 'win32')).toBe(false)
    expect(occdDataRootIsOnLocalDisk('C:\\Users\\u\\AppData\\Roaming\\occ', 'win32')).toBe(true)
    expect(occdDataRootIsOnLocalDisk('\\\\?\\C:\\Users\\u\\occ', 'win32')).toBe(true)
  })
})
