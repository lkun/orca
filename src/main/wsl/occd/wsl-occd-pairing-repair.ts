/** Use the managed SSH repair gate for refused WSL enrollment: serialize, cap attempts and require the pinned host key. Read new offers inside the local distro. */
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  findWslHostDeployment,
  refreshWslHostPairing
} from '../../../shared/remote-runtime/host-store/runtime-environment-wsl-host-store'
import type { KnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { readActiveManagedOCCdReadiness } from '../../managed-server/lifecycle/occd-managed-bound-port'
import {
  ManagedOCCdPairingRepairs,
  type ManagedOCCdPairingRepairDeps
} from '../../managed-server/lifecycle/occd-managed-pairing-repair'

import { OCCdManagedPairingRepairFailedError } from '../../managed-server/lifecycle/occd-managed-pairing-repair-failure'
import { notifyManagedOCCdPairingRepaired } from '../../managed-server/lifecycle/occd-managed-pairing-repaired-listener'
import type { WslOCCdHostTarget } from './wsl-occd-host-target'
import { type WslOCCdHostTransport, createWslOCCdHostTransport } from './wsl-occd-host-transport'
import type { WslOCCdPairingRecovery } from './wsl-occd-pairing-identity'

type WslOCCdHostAccess = { target: WslOCCdHostTarget; connection: WslOCCdHostTransport }

export function liveWslOCCdPairingRepairDeps(
  userDataPath: string
): ManagedOCCdPairingRepairDeps<WslOCCdHostAccess> {
  const record = (environmentId: string) => {
    const found = findWslHostDeployment(userDataPath, environmentId)
    if (!found) {
      throw new OCCdManagedPairingRepairFailedError('this server is not a WSL host')
    }
    return found
  }
  return {
    resolve: (environmentId) => resolveEnvironment(userDataPath, environmentId),
    connect: async (environment: KnownRuntimeEnvironment) => {
      const target: WslOCCdHostTarget = {
        kind: 'wsl',
        id: environment.id,
        distro: record(environment.id).distro,
        label: environment.name
      }
      return { target, connection: createWslOCCdHostTransport({ target }) }
    },
    readReadiness: async (access) => {
      try {
        return await readActiveManagedOCCdReadiness(access)
      } finally {
        access.connection.dispose()
      }
    },
    ports: (environment) => {
      const found = findWslHostDeployment(userDataPath, environment.id)
      return found ? { localPort: found.localPort, remotePort: found.remotePort } : null
    },
    refresh: (environmentId, pairingCode) => {
      const { localPort, remotePort } = record(environmentId)
      return refreshWslHostPairing(userDataPath, environmentId, {
        pairingCode,
        localPort,
        remotePort
      }).environment
    },
    repaired: notifyManagedOCCdPairingRepaired,
    now: Date.now
  }
}

/** One gate per desktop, so the cap and a standing failure hold across every WSL connect. */
export function createWslOCCdPairingRecovery(
  userDataPath: string,
  deps: ManagedOCCdPairingRepairDeps<WslOCCdHostAccess> = liveWslOCCdPairingRepairDeps(
    userDataPath
  )
): Omit<WslOCCdPairingRecovery, 'environmentId'> {
  return { repairs: new ManagedOCCdPairingRepairs(deps), resolve: deps.resolve }
}
