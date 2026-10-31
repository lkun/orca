import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

const shim = vi.hoisted(() => ({ ensureLinuxTerminalOCCCliShimDir: vi.fn() }))
vi.mock('./linux-terminal-occ-cli-shim', () => shim)

import { prependOCCCliDirToChildPath } from './occ-cli-child-path'

const USER_DATA = '/data/occ'
const SHIM_DIR = join(USER_DATA, 'linux-occ-cli-shim')

beforeEach(() => {
  installFakeAppEnvironment()
  shim.ensureLinuxTerminalOCCCliShimDir.mockReset()
  shim.ensureLinuxTerminalOCCCliShimDir.mockReturnValue(SHIM_DIR)
})

afterEach(() => installFakeAppEnvironment())

describe('prependOCCCliDirToChildPath', () => {
  it.each(['linux', 'darwin'] as const)(
    'uses the %s execution host CLI and profile over inherited values',
    (platform) => {
      const launcher = join(USER_DATA, 'cli', 'bin', 'occ')
      installFakeAppEnvironment({ getCliLauncherPath: () => launcher })
      const env: Record<string, string> = {
        PATH: `/usr/bin:${join(USER_DATA, 'cli', 'bin')}::/bin`,
        OCC_USER_DATA_PATH: '/parent/profile',
        OCC_CLI_COMMAND: '/parent/occ',
        OCC_CLI_BIN_DIR: '/parent/bin'
      }
      expect(
        prependOCCCliDirToChildPath(env, {
          isPackaged: true,
          userDataPath: USER_DATA,
          resourcesPath: null,
          platform
        })
      ).toBe(launcher)
      expect(env.PATH).toBe(`${join(USER_DATA, 'cli', 'bin')}:/usr/bin:/bin`)
      expect(env.OCC_USER_DATA_PATH).toBe(USER_DATA)
      expect(env.OCC_CLI_COMMAND).toBe(launcher)
      expect(env.OCC_CLI_BIN_DIR).toBe(join(USER_DATA, 'cli', 'bin'))
      expect(shim.ensureLinuxTerminalOCCCliShimDir).not.toHaveBeenCalled()
    }
  )
  it('exports the owning packaged Linux launcher and profile together with PATH', () => {
    const env = {
      PATH: `/usr/bin:${SHIM_DIR}::/bin`,
      OCC_CLI_COMMAND: '/other/occ',
      OCC_USER_DATA_PATH: '/other/profile'
    }
    const launcher = prependOCCCliDirToChildPath(env, {
      isPackaged: true,
      userDataPath: USER_DATA,
      platform: 'linux'
    })

    expect(launcher).toBe(join(SHIM_DIR, 'occ'))
    expect(env.OCC_CLI_COMMAND).toBe(launcher)
    expect(env.OCC_USER_DATA_PATH).toBe(USER_DATA)
    expect(env.PATH).toBe(`${SHIM_DIR}:/usr/bin:/bin`)
  })

  it('puts a Windows execution host CLI first on Path without a POSIX restore dir', () => {
    const binDir = join(USER_DATA, 'cli', 'bin')
    const launcher = join(binDir, 'occ.exe')
    installFakeAppEnvironment({ getCliLauncherPath: () => launcher })
    const env: Record<string, string> = {
      Path: `C:\\Windows;${binDir};;C:\\Tools`,
      OCC_USER_DATA_PATH: 'C:\\parent\\profile',
      OCC_CLI_COMMAND: 'C:\\parent\\occ.exe',
      OCC_CLI_BIN_DIR: '/parent/bin'
    }
    expect(
      prependOCCCliDirToChildPath(env, {
        isPackaged: true,
        userDataPath: USER_DATA,
        resourcesPath: null,
        platform: 'win32'
      })
    ).toBe(launcher)
    expect(env).toEqual({
      Path: `${binDir};C:\\Windows;C:\\Tools`,
      OCC_USER_DATA_PATH: USER_DATA,
      OCC_CLI_COMMAND: launcher
    })
  })

  it('writes no trailing delimiter when nothing was inherited', () => {
    const env: Record<string, string> = { PATH: '' }
    const inheritedPath = process.env.PATH
    delete process.env.PATH
    try {
      prependOCCCliDirToChildPath(env, {
        isPackaged: false,
        userDataPath: USER_DATA,
        platform: 'linux'
      })
    } finally {
      if (inheritedPath !== undefined) {
        process.env.PATH = inheritedPath
      }
    }
    // Why: an empty trailing segment resolves as `.` in some shells.
    expect(env.PATH).toBe(join(USER_DATA, 'cli', 'bin'))
  })
})
