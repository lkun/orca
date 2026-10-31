/**
 * Lets a WSL distro stop once its occd idle-stops with nothing left to keep (R40). The desktop's
 * holder keeps the distro up; it reads this request and ends after occd's pid exits.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { OCCD_WSL_HOLDER_RELEASE_FILENAME } from '../../shared/occd-idle-exit'
import { writeSecureFile } from '../../shared/secure-file'
import { OCCD_WSL_HOST_ENV } from '../ipc/wsl-guest-windows-drive-path'
import type { OCCdDaemonRetirement } from './occd-daemon-retirement'

export function occdWslHolderReleasePath(userDataPath: string): string {
  return join(userDataPath, OCCD_WSL_HOLDER_RELEASE_FILENAME)
}

/**
 * Only a WSL-host launch has a holder, and only a daemon that proved itself empty and left shows
 * no terminal would die with the distro. Why the launch marker: a setsid'd occd may lack WSL_DISTRO_NAME.
 */
export function idleStopMayReleaseWslHolder(
  env: NodeJS.ProcessEnv,
  daemon: OCCdDaemonRetirement
): boolean {
  return env[OCCD_WSL_HOST_ENV] === '1' && daemon.retirement === 'retired'
}

export function requestOCCdWslHolderRelease(userDataPath: string, pid = process.pid): void {
  writeSecureFile(occdWslHolderReleasePath(userDataPath), `${pid}\n`)
}

/**
 * A starting occd may be given work, so any earlier request no longer stands. WSL-host launches
 * only; never throws, so a locked or unwritable data root cannot fail a start or a stop.
 */
export function withdrawOCCdWslHolderRelease(
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env[OCCD_WSL_HOST_ENV] !== '1') {
    return
  }
  try {
    rmSync(occdWslHolderReleasePath(userDataPath), { force: true })
  } catch (error) {
    console.error('[occd] could not withdraw the WSL holder release request:', error)
  }
}
