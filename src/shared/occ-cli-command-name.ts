import { getAppEnvironment, hasAppEnvironment } from './app-environment'

export function getOCCCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'occ-ide'
  }
  if (platform === 'win32') {
    return 'occ.cmd'
  }
  return 'occ'
}

/** The GNOME-conflict `occ-ide` rename is desktop-only: SSH relays and headless OCC servers put plain `occ` on PATH. */
export function skipsLinuxOCCCliRename(isRemote: boolean | undefined): boolean {
  if (isRemote) {
    return true
  }
  // Only a headless server publishes its own launcher; Windows ones (WSL launches) keep the rename.
  const launcher = hasAppEnvironment() ? getAppEnvironment().getCliLauncherPath?.() : null
  return launcher?.endsWith('/occ') ?? false
}
