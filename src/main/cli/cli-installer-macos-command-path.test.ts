import { link, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => tmpdir(),
    getAppPath: () => tmpdir()
  }
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock
}))

import { CliInstaller } from './cli-installer'
import { createPackagedMacLauncher, makeFixture } from './cli-installer-test-fixtures'

async function makeBundledLauncherFixture() {
  const fixture = await makeFixture()
  const launcher = await readFile(join(process.cwd(), 'resources', 'darwin', 'bin', 'occ'), 'utf8')
  const resourcesPath = await createPackagedMacLauncher(fixture.root, launcher)
  const bundledBin = join(resourcesPath, 'bin')
  const launcherPath = join(bundledBin, 'occ')
  return {
    root: fixture.root,
    bundledBin,
    installerOptions: {
      platform: 'darwin' as const,
      isPackaged: true,
      resourcesPath,
      userDataPath: fixture.userDataPath,
      execPath: '/Applications/OCC.app/Contents/MacOS/OCC',
      appPath: fixture.appPath,
      homePath: join(fixture.root, 'home')
    },
    expectLauncherIntact: async () => {
      expect((await lstat(launcherPath)).isSymbolicLink()).toBe(false)
      expect(await readFile(launcherPath, 'utf8')).toBe(launcher)
    }
  }
}

describe('CliInstaller', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.skipIf(process.platform === 'win32')(
    'reports a conflict for an unmanaged macOS occ that shadows the install path',
    async () => {
      const fixture = await makeFixture()
      const homePath = join(fixture.root, 'home')
      const resourcesPath = await createPackagedMacLauncher(fixture.root)
      const usrLocalBin = join(fixture.root, 'usr', 'local', 'bin')
      const userLocalBin = join(homePath, '.local', 'bin')
      const defaultInstallPath = join(usrLocalBin, 'occ')
      const userInstallPath = join(userLocalBin, 'occ')
      await mkdir(usrLocalBin, { recursive: true })
      await mkdir(userLocalBin, { recursive: true })
      await writeFile(userInstallPath, '#!/usr/bin/env bash\necho other-occ\n', {
        encoding: 'utf8',
        mode: 0o755
      })

      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: true,
        resourcesPath,
        userDataPath: fixture.userDataPath,
        execPath: '/Applications/OCC.app/Contents/MacOS/OCC',
        appPath: fixture.appPath,
        homePath,
        defaultMacCommandPath: defaultInstallPath,
        processPathEnv: `${userLocalBin}:${usrLocalBin}`
      })

      const status = await installer.getStatus()
      expect(status.commandPath).toBe(userInstallPath)
      expect(status.state).toBe('conflict')
      await expect(installer.install()).rejects.toThrow('Refusing to replace non-OCC command')
      await expect(lstat(defaultInstallPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(userInstallPath, 'utf8')).resolves.toContain('other-occ')
    }
  )

  // Why (#33872): OCC terminals put the bundled bin dir first on PATH, so registration linked the launcher to itself.
  describe.skipIf(process.platform === 'win32')('with the bundled launcher on PATH', () => {
    it('registers the default command instead of linking the launcher to itself', async () => {
      const { root, bundledBin, installerOptions, expectLauncherIntact } =
        await makeBundledLauncherFixture()
      const usrLocalBin = join(root, 'usr', 'local', 'bin')
      await mkdir(usrLocalBin, { recursive: true })

      const status = await new CliInstaller({
        ...installerOptions,
        defaultMacCommandPath: join(usrLocalBin, 'occ'),
        processPathEnv: [bundledBin, usrLocalBin].join(':')
      }).install()

      expect(status.state).toBe('installed')
      expect(status.commandPath).toBe(join(usrLocalBin, 'occ'))
      await expectLauncherIntact()
    })

    it('refuses a command path that reaches the launcher through an aliased directory', async () => {
      const { root, bundledBin, installerOptions, expectLauncherIntact } =
        await makeBundledLauncherFixture()
      const aliasBin = join(root, 'alias-bin')
      await symlink(bundledBin, aliasBin)

      const installer = new CliInstaller({
        ...installerOptions,
        commandPathOverride: join(aliasBin, 'occ')
      })

      await expect(installer.install()).rejects.toThrow('link to itself')
      await expectLauncherIntact()
    })

    it('still replaces a hard link to the launcher in another directory', async () => {
      const { root, bundledBin, installerOptions, expectLauncherIntact } =
        await makeBundledLauncherFixture()
      const usrLocalBin = join(root, 'usr', 'local', 'bin')
      await mkdir(usrLocalBin, { recursive: true })
      const hardLink = join(usrLocalBin, 'occ')
      await link(join(bundledBin, 'occ'), hardLink)

      const status = await new CliInstaller({
        ...installerOptions,
        commandPathOverride: hardLink
      }).install()

      expect(status.state).toBe('installed')
      expect((await lstat(hardLink)).isSymbolicLink()).toBe(true)
      await expectLauncherIntact()
    })
  })
})
