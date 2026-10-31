import { browserSessionRegistry } from './browser-session-registry'
import type { BrowserSessionRegistryProfileOptions } from './browser-session-registry'
import { collectOrphanedBrowserRoutePartitionStorage } from './browser-route-partition-storage-runtime'
import { configureRouteSessionsForOCCProfile } from './browser-route-session-runtime'
import { configureBrowserSitePermissionStore } from './browser-site-permission-store'
import { configureBrowserSiteDisplayStore } from './browser-site-display-store'
import { configureBrowserExtensionProfileDataDirectory } from './extensions/browser-extension-profile-data-directory'
import { configurePairedRuntimeBrowserClientHostsForOCCProfile } from './paired-runtime-browser-client-host-runtime'

let initialized = false

export function initializeBrowserSessionsForApp(
  activeProfile?: BrowserSessionRegistryProfileOptions & {
    listLocalSshTargetIds?: () => string[]
  }
): void {
  if (initialized) {
    return
  }

  if (activeProfile) {
    browserSessionRegistry.configureForOCCProfile(activeProfile)
    configureBrowserSitePermissionStore(activeProfile.profileDirectory)
    configureBrowserSiteDisplayStore(activeProfile.profileDirectory)
    configureBrowserExtensionProfileDataDirectory(activeProfile.profileDirectory)
    configureRouteSessionsForOCCProfile({
      occProfileId: activeProfile.occProfileId,
      profileDirectory: activeProfile.profileDirectory
    })
    configurePairedRuntimeBrowserClientHostsForOCCProfile({
      occProfileId: activeProfile.occProfileId
    })
    void collectOrphanedBrowserRoutePartitionStorage(activeProfile.listLocalSshTargetIds).catch(
      (error) => {
        console.warn('[browser-route-partition] orphan collection failed:', error)
      }
    )
  }

  // Replay cookies before Chromium opens the live DB via session.fromPartition.
  browserSessionRegistry.applyPendingCookieImport()
  browserSessionRegistry.initializeBrowserSessionsFromPersistedState()
  initialized = true
}

/** Whether a partition may be opened: before this, opening one would skip a pending cookie import. */
export function browserSessionsInitialized(): boolean {
  return initialized
}
