import { app } from 'electron'
import { join } from 'node:path'

let occProfileDirectory: string | null = null

/** Browser profile ids repeat across OCC profiles ("default"), so their extension data lives per OCC profile. */
export function configureBrowserExtensionProfileDataDirectory(profileDirectory: string): void {
  occProfileDirectory = profileDirectory
}

/** Root of the per-browser-profile extension stores (sync storage, grants and state, DNR). */
export function getBrowserExtensionProfileDataDirectory(): string {
  return join(occProfileDirectory ?? app.getPath('userData'), 'browser-extensions')
}
