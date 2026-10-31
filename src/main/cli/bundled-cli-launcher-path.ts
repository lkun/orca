import { join } from 'node:path'

// Why `occ-ide` on Linux: GNOME's occ screen reader ships /usr/bin/occ, so the CLI avoids that name.
export const LINUX_CLI_COMMAND_NAME = 'occ-ide'

// Keep path-only callers independent of cli-installer's Electron dependency.
export function getBundledLauncherPath(
  platform: NodeJS.Platform,
  resourcesPath: string
): string | null {
  if (platform === 'darwin') {
    return join(resourcesPath, 'bin', 'occ')
  }
  if (platform === 'linux') {
    return join(resourcesPath, 'bin', LINUX_CLI_COMMAND_NAME)
  }
  if (platform === 'win32') {
    return join(resourcesPath, 'bin', 'occ.exe')
  }
  return null
}
