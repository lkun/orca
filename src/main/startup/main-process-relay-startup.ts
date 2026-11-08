import { app, powerMonitor } from 'electron'
import { getOCCCloudAuthConfig } from '../occ-profiles/profile-cloud-auth-config'
import { getProfileUserDataPath } from '../occ-profiles/profile-storage-paths'
import type { OCCRuntimeRpcServer } from '../runtime/rpc/server/runtime-rpc'
import { DesktopRelayService } from '../runtime/mobile-cloud-relay/desktop-relay-service'
import { createDesktopRelayServiceInstaller } from '../runtime/mobile-cloud-relay/desktop-relay-service-installer'
import { publishDesktopRelayStatus } from './main-process-relay-status'
import { mainProcessState as state } from './main-process-state'

// Register before proxy readiness; the installer waits before its first request.
export function startDesktopRelayService(runtimeRpc: OCCRuntimeRpcServer): void {
  const installer = createDesktopRelayServiceInstaller({
    runtimeRpc,
    whenNetworkReady: state.initialProxyApplicationReady,
    isFenced: () => state.isQuitting,
    create: () => {
      const cloudAuth = getOCCCloudAuthConfig()
      return cloudAuth.configured
        ? new DesktopRelayService({
            authConfig: cloudAuth.config,
            userDataPath: getProfileUserDataPath(),
            appVersion: app.getVersion(),
            runtimeRpc,
            onStatus: publishDesktopRelayStatus
          })
        : null
    },
    onInstalled: (service) => {
      state.desktopRelayService = service
    }
  })
  state.desktopRelayInstaller = installer
  runtimeRpc.setMobileRelayPairingProviderInstaller(() => installer.ensure())
  // Sleep can expire the token with no retry timer; resume is the recovery opportunity.
  powerMonitor.on('resume', () => state.desktopRelayService?.ensureLive())
  void installer.ensure()
}
