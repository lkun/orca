import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  OCCD_CLI_ENTRY_FILENAME,
  OCCD_WINDOWS_CLI_LAUNCHER_FILENAME
} from '../../shared/occd-artifacts'
import { nodeFileContentsEqual } from '../../shared/node-file-content-equality'
import { buildUnixCliLauncher } from '../cli/cli-dev-launcher'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import { resolveOCCdInstallRoot, resolveUserDataPath } from './occd-app-paths'

// The native Windows launcher selects server mode when this sibling config exists.
export const OCCD_WINDOWS_CLI_LAUNCHER_CONFIG_FILENAME = 'occ-launcher.cfg'
const RETIRED_LAUNCHER_SUFFIX = '.retired'

let launcherPath: string | null = null

export function getOCCdCliLauncherPath(): string | null {
  return launcherPath
}

export async function prepareOCCdCliLauncher(): Promise<void> {
  launcherPath = null
  const installRoot = resolveOCCdInstallRoot()
  const entry = join(installRoot, ...OCCD_CLI_ENTRY_FILENAME.split('/'))
  // Older slots and source-only runs may lack the CLI.
  if (!existsSync(entry)) {
    return
  }
  const userDataPath = resolveUserDataPath()
  const binDir = join(userDataPath, 'cli', 'bin')
  if (process.platform === 'win32') {
    launcherPath = await prepareWindowsLauncher(installRoot, entry, userDataPath, binDir)
    return
  }
  const script = buildUnixCliLauncher(process.execPath, entry, userDataPath, 'node')
  await mkdir(binDir, { recursive: true })
  // Older clients type the Linux desktop `occ-ide claude-teams` into server terminals.
  const names = process.platform === 'linux' ? ['occ', 'occ-ide'] : ['occ']
  for (const name of names) {
    const path = join(binDir, name)
    const current = await readFile(path, 'utf8').catch(() => null)
    if (current !== script) {
      writeFileAtomically(path, script, { mode: 0o700 })
    }
    await chmod(path, 0o700)
  }
  launcherPath = join(binDir, 'occ')
}

export function buildWindowsCliLauncherConfig(
  nodePath: string,
  cliEntryPath: string,
  userDataPath: string
): string {
  return `node=${nodePath}\ncli=${cliEntryPath}\nuser-data=${userDataPath}\n`
}

/** Native exe preserves arguments that cmd.exe reparses through batch %*. */
async function prepareWindowsLauncher(
  installRoot: string,
  entry: string,
  userDataPath: string,
  binDir: string
): Promise<string | null> {
  const source = join(installRoot, ...OCCD_WINDOWS_CLI_LAUNCHER_FILENAME.split('/'))
  if (!existsSync(source)) {
    return null
  }
  const path = join(binDir, 'occ.exe')
  await mkdir(binDir, { recursive: true })
  await removeRetiredLaunchers(binDir)
  const binary = await readFile(source)
  if (!(await nodeFileContentsEqual(path, binary).catch(() => false))) {
    try {
      writeFileAtomically(path, binary)
    } catch {
      // Windows locks running images against overwrite but allows retirement by rename.
      await rename(path, `${path}.${randomUUID()}${RETIRED_LAUNCHER_SUFFIX}`)
      writeFileAtomically(path, binary)
    }
  }
  const configPath = join(binDir, OCCD_WINDOWS_CLI_LAUNCHER_CONFIG_FILENAME)
  const config = buildWindowsCliLauncherConfig(process.execPath, entry, userDataPath)
  if ((await readFile(configPath, 'utf8').catch(() => null)) !== config) {
    writeFileAtomically(configPath, config)
  }
  return path
}

async function removeRetiredLaunchers(binDir: string): Promise<void> {
  const names = await readdir(binDir).catch(() => [])
  await Promise.all(
    names
      .filter((name) => name.startsWith('occ.exe.') && name.endsWith(RETIRED_LAUNCHER_SUFFIX))
      // Running retired images remain until a later cleanup.
      .map((name) => rm(join(binDir, name), { force: true }).catch(() => {}))
  )
}
