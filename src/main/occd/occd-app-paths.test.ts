import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppPathName } from '../../shared/app-environment'
import { resolveOCCdInstallRoot, resolveOCCdPath, resolveUserDataPath } from './occd-app-paths'

const ALL_PATH_NAMES: AppPathName[] = [
  'userData',
  'home',
  'appData',
  'temp',
  'downloads',
  'logs',
  'exe'
]

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.unstubAllEnvs()
})

describe('resolveUserDataPath', () => {
  it('prefers OCC_USER_DATA, then XDG_DATA_HOME, then ~/.occ', () => {
    vi.stubEnv('OCC_USER_DATA', join(sep, 'srv', 'occ-state'))
    vi.stubEnv('XDG_DATA_HOME', join(sep, 'xdg'))
    expect(resolveUserDataPath()).toBe(join(sep, 'srv', 'occ-state'))

    vi.stubEnv('OCC_USER_DATA', '')
    expect(resolveUserDataPath()).toBe(join(sep, 'xdg', 'OCC'))

    vi.stubEnv('XDG_DATA_HOME', '')
    expect(resolveUserDataPath()).toBe(join(homedir(), '.occ'))
  })
})

describe('resolveOCCdPath', () => {
  it('answers every path name without ever falling back to the data directory', () => {
    vi.stubEnv('OCC_USER_DATA', join(sep, 'srv', 'occ-state'))
    const answers = new Map(ALL_PATH_NAMES.map((name) => [name, resolveOCCdPath(name)]))

    for (const [name, answer] of answers) {
      expect(answer, `${name} answered nothing`).toBeTruthy()
      if (name !== 'userData') {
        expect(answer, `${name} answered the userData directory`).not.toBe(
          join(sep, 'srv', 'occ-state')
        )
      }
    }
  })

  it("answers 'exe' with the Node binary running this process", () => {
    expect(resolveOCCdPath('exe')).toBe(process.execPath)
  })

  it("keeps 'logs' inside the data root so the whole deployment is one directory", () => {
    vi.stubEnv('OCC_USER_DATA', join(sep, 'srv', 'occ-state'))
    expect(resolveOCCdPath('logs')).toBe(join(sep, 'srv', 'occ-state', 'logs'))
  })

  it("answers 'home' and 'temp' from the OS", () => {
    expect(resolveOCCdPath('home')).toBe(homedir())
    expect(resolveOCCdPath('temp')).toBe(tmpdir())
  })

  it("answers 'appData' with the per-user application-data root of each platform", () => {
    setPlatform('darwin')
    expect(resolveOCCdPath('appData')).toBe(join(homedir(), 'Library', 'Application Support'))

    setPlatform('win32')
    vi.stubEnv('APPDATA', join('C:', 'Users', 'occ', 'AppData', 'Roaming'))
    expect(resolveOCCdPath('appData')).toBe(join('C:', 'Users', 'occ', 'AppData', 'Roaming'))
    vi.stubEnv('APPDATA', '')
    expect(resolveOCCdPath('appData')).toBe(join(homedir(), 'AppData', 'Roaming'))

    setPlatform('linux')
    vi.stubEnv('XDG_CONFIG_HOME', join(sep, 'xdg-config'))
    expect(resolveOCCdPath('appData')).toBe(join(sep, 'xdg-config'))
    vi.stubEnv('XDG_CONFIG_HOME', '')
    expect(resolveOCCdPath('appData')).toBe(join(homedir(), '.config'))
  })

  it("answers 'downloads' from XDG_DOWNLOAD_DIR before the home default", () => {
    vi.stubEnv('XDG_DOWNLOAD_DIR', join(sep, 'srv', 'incoming'))
    expect(resolveOCCdPath('downloads')).toBe(join(sep, 'srv', 'incoming'))

    vi.stubEnv('XDG_DOWNLOAD_DIR', '')
    expect(resolveOCCdPath('downloads')).toBe(join(homedir(), 'Downloads'))
  })
})

describe('resolveOCCdInstallRoot', () => {
  it('is the directory holding the running bundle, not the working directory', () => {
    expect(resolveOCCdInstallRoot(join(sep, 'opt', 'occ', 'occd.js'))).toBe(
      join(sep, 'opt', 'occ')
    )
  })

  it('absolutizes a relative script path against the working directory', () => {
    expect(resolveOCCdInstallRoot(join('out', 'occd', 'occd.js'))).toBe(
      join(process.cwd(), 'out', 'occd')
    )
  })

  // Bundle siblings live beside symlink targets, not the link.
  it.skipIf(process.platform === 'win32')('follows a symlinked script to the real bundle', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'occd-install-root-')))
    try {
      const bundle = join(root, 'slot')
      const bin = join(root, 'bin')
      mkdirSync(bundle)
      mkdirSync(bin)
      writeFileSync(join(bundle, 'occd.js'), '')
      symlinkSync(join(bundle, 'occd.js'), join(bin, 'occd'))
      expect(resolveOCCdInstallRoot(join(bin, 'occd'))).toBe(bundle)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses instead of guessing when the process has no main script', () => {
    const originalArgv = process.argv
    // node -e omits argv[1]; cwd cannot establish the install root.
    process.argv = [process.execPath]
    try {
      expect(() => resolveOCCdInstallRoot()).toThrow(/occd_install_root_unavailable/)
    } finally {
      process.argv = originalArgv
    }
  })
})
