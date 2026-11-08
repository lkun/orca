import { mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
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

describe('CliInstaller', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // Older builds wrote generated launcher files directly into /usr/local/bin/occ.
  it.skipIf(process.platform === 'win32')(
    'replaces stale generated Unix launcher files',
    async () => {
      const fixture = await makeFixture()
      const commandDir = join(fixture.root, 'bin')
      const installPath = join(commandDir, 'occ')
      const resourcesPath = join(fixture.root, 'Current.app', 'Contents', 'Resources')
      const launcherPath = join(resourcesPath, 'bin', 'occ')
      const oldCliPath = join(fixture.root, 'OldWorktree', 'out', 'cli', 'index.js')
      await mkdir(commandDir, { recursive: true })
      await mkdir(join(resourcesPath, 'bin'), { recursive: true })
      await writeFile(launcherPath, '#!/usr/bin/env bash\n', 'utf8')
      await writeFile(
        installPath,
        [
          '#!/usr/bin/env bash',
          'set -euo pipefail',
          "ELECTRON='/tmp/Old.app/Contents/MacOS/Electron'",
          `CLI='${oldCliPath}'`,
          'export OCC_NODE_OPTIONS="${NODE_OPTIONS-}"',
          'export OCC_NODE_REPL_EXTERNAL_MODULE="${NODE_REPL_EXTERNAL_MODULE-}"',
          'unset NODE_OPTIONS',
          'unset NODE_REPL_EXTERNAL_MODULE',
          'ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"',
          ''
        ].join('\n'),
        'utf8'
      )

      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: true,
        resourcesPath,
        commandPathOverride: installPath,
        processPathEnv: commandDir
      })

      await expect(installer.getStatus()).resolves.toMatchObject({
        state: 'stale',
        currentTarget: oldCliPath
      })
      await expect(installer.install()).resolves.toMatchObject({ state: 'installed' })
      await expect(readlink(installPath)).resolves.toBe(launcherPath)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'keeps arbitrary regular files at the command path as conflicts',
    async () => {
      const fixture = await makeFixture()
      const commandDir = join(fixture.root, 'bin')
      const installPath = join(commandDir, 'occ')
      const resourcesPath = await createPackagedMacLauncher(fixture.root)
      await mkdir(commandDir, { recursive: true })
      await writeFile(
        installPath,
        '#!/usr/bin/env bash\nELECTRON_RUN_AS_NODE=1 /tmp/not-occ "$@"\n',
        'utf8'
      )

      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: true,
        resourcesPath,
        commandPathOverride: installPath,
        processPathEnv: commandDir
      })

      await expect(installer.getStatus()).resolves.toMatchObject({
        state: 'conflict',
        currentTarget: null
      })
      await expect(installer.install()).rejects.toThrow('Refusing to replace non-OCC command')
      await expect(readFile(installPath, 'utf8')).resolves.toContain('/tmp/not-occ')
    }
  )

  it.skipIf(process.platform === 'win32')(
    'replaces stale sibling dev launcher symlinks from packaged installs',
    async () => {
      const fixture = await makeFixture()
      for (const devLauncherName of ['occ', 'occ-dev']) {
        const caseRoot = join(fixture.root, devLauncherName)
        const commandDir = join(caseRoot, 'bin')
        const installPath = join(commandDir, 'occ')
        const userDataPath = join(caseRoot, 'occ')
        const resourcesPath = join(caseRoot, 'Current.app', 'Contents', 'Resources')
        const launcherPath = join(resourcesPath, 'bin', 'occ')
        const devLauncherPath = join(`${userDataPath}-dev`, 'cli', 'bin', devLauncherName)
        await mkdir(commandDir, { recursive: true })
        await mkdir(join(resourcesPath, 'bin'), { recursive: true })
        await mkdir(join(`${userDataPath}-dev`, 'cli', 'bin'), { recursive: true })
        await writeFile(launcherPath, '#!/usr/bin/env bash\n', 'utf8')
        await writeFile(devLauncherPath, '#!/usr/bin/env bash\n', 'utf8')
        await symlink(devLauncherPath, installPath)

        const installer = new CliInstaller({
          platform: 'darwin',
          isPackaged: true,
          userDataPath,
          resourcesPath,
          commandPathOverride: installPath,
          processPathEnv: commandDir
        })

        await expect(installer.getStatus()).resolves.toMatchObject({
          state: 'stale',
          currentTarget: devLauncherPath
        })
        await expect(installer.install()).resolves.toMatchObject({ state: 'installed' })
        await expect(readlink(installPath)).resolves.toBe(launcherPath)
      }
    }
  )
})
