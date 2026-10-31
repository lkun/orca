import { BrowserWindow } from 'electron'
import {
  OCC_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  OCC_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL,
  type OCCCloudSignInProgress
} from '../../shared/occ-profiles'

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    try {
      window.webContents.send(channel, ...args)
    } catch {
      // A renderer can disappear between isDestroyed() and send().
    }
  }
}

export function broadcastOCCProfileAuthStatusChanged(): void {
  broadcast(OCC_PROFILE_AUTH_STATUS_CHANGED_CHANNEL)
}

export function broadcastOCCProfileSignInProgressChanged(
  progress: OCCCloudSignInProgress | null
): void {
  broadcast(OCC_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, progress)
}
