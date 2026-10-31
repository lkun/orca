import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OCCD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/occd-managed-launch-env'
import {
  OCCD_COMPILE_CACHE_DIRNAME,
  enableManagedOCCdCompileCache,
  occdCompileCacheEnv
} from './occd-compile-cache'

const managed = {
  [OCCD_MANAGED_ACTIVATION_ROOT_ENV]: '/home/u/.occ-remote/.fence'
}

describe('managed occd compile cache', () => {
  it('never writes into a slot no client manages, such as a packaged app', () => {
    const enableCompileCache = vi.fn()
    enableManagedOCCdCompileCache('/Applications/OCC.app/occd', {}, { enableCompileCache })
    expect(enableCompileCache).not.toHaveBeenCalled()
  })

  it('starts as before on a runtime without the API or with an unwritable slot', () => {
    expect(() => enableManagedOCCdCompileCache('/slot', managed, {})).not.toThrow()
    const enableCompileCache = vi.fn(() => {
      throw new Error('EACCES')
    })
    expect(() =>
      enableManagedOCCdCompileCache('/slot', managed, { enableCompileCache })
    ).not.toThrow()
  })

  it('hands the preflight child the slot cache only when this process enabled one', () => {
    const enabled = { getCompileCacheDir: () => '/slot/x/v24' }
    expect(occdCompileCacheEnv('/slot', enabled, managed)).toEqual({
      NODE_COMPILE_CACHE: join('/slot', OCCD_COMPILE_CACHE_DIRNAME)
    })
    expect(occdCompileCacheEnv('/slot', { getCompileCacheDir: () => undefined }, managed)).toEqual(
      {}
    )
    expect(occdCompileCacheEnv('/slot', {}, managed)).toEqual({})
    expect(occdCompileCacheEnv('/slot', enabled, {})).toEqual({})
  })
})
