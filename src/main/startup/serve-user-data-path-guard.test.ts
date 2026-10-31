import { describe, expect, it, vi } from 'vitest'
import { checkServeUserDataPath } from './serve-user-data-path-guard'

describe('checkServeUserDataPath', () => {
  it('refuses a serve that landed on a profile other than the one the CLI chose', () => {
    const env: NodeJS.ProcessEnv = { OCC_SERVE_USER_DATA_PATH: '/isolated/profile' }
    expect(
      checkServeUserDataPath({ isServeMode: true, userDataPath: '/default/occ', env })
    ).toContain('/isolated/profile')
    expect(env.OCC_SERVE_USER_DATA_PATH).toBeUndefined()
  })

  it('allows the chosen profile, including another spelling of it', () => {
    expect(
      checkServeUserDataPath({
        isServeMode: true,
        userDataPath: '/isolated/profile',
        env: { OCC_SERVE_USER_DATA_PATH: '/isolated/./profile/' }
      })
    ).toBeNull()
    expect(
      checkServeUserDataPath({
        isServeMode: true,
        userDataPath: 'C:\\Users\\Me\\OCC',
        env: { OCC_SERVE_USER_DATA_PATH: 'c:\\users\\me\\occ' },
        platform: 'win32'
      })
    ).toBeNull()
  })

  it('leaves launches without a CLI choice, or outside serve, alone', () => {
    expect(checkServeUserDataPath({ isServeMode: true, userDataPath: '/a', env: {} })).toBeNull()
    const env: NodeJS.ProcessEnv = { OCC_SERVE_USER_DATA_PATH: '/b' }
    expect(checkServeUserDataPath({ isServeMode: false, userDataPath: '/a', env })).toBeNull()
    expect(env.OCC_SERVE_USER_DATA_PATH).toBeUndefined()
  })
})

describe('configureOCCUserDataPathEnv on a serve launch', () => {
  it('throws before the instance lock instead of publishing a mismatched profile', async () => {
    vi.doMock('electron', () => ({ app: { getPath: () => '/default/occ' } }))
    const { configureOCCUserDataPathEnv } = await import('./configure-process')
    const argv = process.argv
    const previous = process.env.OCC_USER_DATA_PATH
    process.argv = [...argv, '--serve']
    process.env.OCC_SERVE_USER_DATA_PATH = '/isolated/profile'
    process.env.OCC_USER_DATA_PATH = '/isolated/profile'
    try {
      expect(() => configureOCCUserDataPathEnv()).toThrow('/isolated/profile')
      expect(process.env.OCC_USER_DATA_PATH).toBe('/isolated/profile')
    } finally {
      process.argv = argv
      delete process.env.OCC_SERVE_USER_DATA_PATH
      if (previous === undefined) {
        delete process.env.OCC_USER_DATA_PATH
      } else {
        process.env.OCC_USER_DATA_PATH = previous
      }
      vi.doUnmock('electron')
    }
  })
})
