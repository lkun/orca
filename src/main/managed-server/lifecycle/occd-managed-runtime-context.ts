import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { OCCD_UPDATE_TERMINALS_RUNNING_CODE } from '../../../shared/occd-managed-runtime'
import {
  getOCCdSshDeployment,
  type KnownRuntimeEnvironment,
  type OCCdSshDeploymentLink
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { getManagedOCCdFenceEnvironmentId } from '../../../shared/managed-occd-ssh-owner'
import type { ServeReadiness } from '../../server/serve-readiness'
import { computeLocalOCCdBuildHash } from '../../ssh/occd-local-build-hash'
import { sshOCCdHostTransport } from '../../ssh/occd-ssh-host-transport'
import type { OCCdHostTarget } from '../../ssh/occd-host-transport'
import type { OCCdActivationRecord } from '../activation/occd-activation-record'
import { admitOCCdRecordForIntent, type OCCdUpdateIntent } from './occd-managed-update-decision'
import {
  type OCCdTerminalCensus,
  UNVERIFIABLE_OCCD_TERMINAL_CENSUS
} from '../../../shared/occd-terminal-census'
import { probeActiveOCCdReadiness } from '../../ssh/occd-active-readiness'
import { resolveOCCdRemoteContext, type OCCdRemoteContext } from '../install/occd-remote-context'
import { OCCD_INSTALL_MODEL } from '../install/remote-install-model'
import { computeRemoteInstallDir } from '../install/remote-versioned-install'
import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../ssh/targets/ssh-target-registry'

const OCCD_BIND_HOST = '127.0.0.1'

// Pinned slots must fail on absent markers rather than silently use host Node.
const MANAGED_OCCD_LEGACY_NODE_PATH = ''

export function requireManagedOCCdInfrastructure() {
  const targetStore = requireManagedOCCdTargetStore()
  const connectionManager = getSshConnectionManager()
  if (!connectionManager) {
    throw new Error('SSH is unavailable on this client; this host’s OCC server is unverifiable.')
  }
  return { connectionManager, targetStore, claims: targetStore.getOCCdRuntimeClaims() }
}

export function requireManagedOCCdTargetStore() {
  const targetStore = getSshTargetRegistryStore()
  if (!targetStore) {
    throw new Error('SSH target state is unavailable; this host’s OCC server is unverifiable.')
  }
  return targetStore
}

export function requireManagedOCCdEnvironment(
  userDataPath: string,
  selector: string
): { environment: KnownRuntimeEnvironment; deployment: OCCdSshDeploymentLink } {
  const environment = resolveEnvironment(userDataPath, selector)
  const deployment = getOCCdSshDeployment(environment)
  if (!deployment || environment.connectionDependency !== 'ssh-tunnel') {
    throw new Error('This server is not managed through an occd SSH deployment.')
  }
  return { environment, deployment }
}

export async function resolveLinkedOCCdContext(
  environment: KnownRuntimeEnvironment,
  deployment: OCCdSshDeploymentLink,
  signal?: AbortSignal
): Promise<OCCdRemoteContext> {
  const { connectionManager, targetStore } = requireManagedOCCdInfrastructure()
  const target = targetStore.getTarget(deployment.sshTargetId)
  if (
    !target ||
    target.generation !== deployment.sshTargetGeneration ||
    getManagedOCCdFenceEnvironmentId(target) !== environment.id
  ) {
    throw new Error('The SSH registration for this host’s OCC server is no longer valid.')
  }
  const connection = await connectionManager.connect(target)
  return resolveOCCdRemoteContext(target, sshOCCdHostTransport(connection), signal)
}

export function managedOCCdSlot(
  context: OCCdRemoteContext<OCCdHostTarget>,
  port: number,
  signal?: AbortSignal
) {
  return {
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    nodePath: MANAGED_OCCD_LEGACY_NODE_PATH,
    userDataDir: context.userDataDir,
    bindHost: OCCD_BIND_HOST,
    port,
    signal
  }
}

export function managedOCCdInstallDir(
  context: OCCdRemoteContext<OCCdHostTarget>,
  version: string
): string {
  return computeRemoteInstallDir(
    OCCD_INSTALL_MODEL,
    context.remoteHome,
    version,
    context.host.pathFlavor
  )
}

/** Accept readiness only from the build this client holds. */
export function probeManagedOCCdReadiness(
  context: OCCdRemoteContext<OCCdHostTarget>,
  localOCCdDir: string,
  fullVersion: string,
  signal?: AbortSignal
): Promise<ServeReadiness> {
  return probeActiveOCCdReadiness(
    {
      conn: context.connection,
      host: context.host,
      remoteInstallDir: managedOCCdInstallDir(context, fullVersion),
      signal
    },
    { buildHash: computeLocalOCCdBuildHash(localOCCdDir), fullVersion }
  )
}

export function managedOCCdDeployPolicy(
  context: Pick<OCCdRemoteContext<OCCdHostTarget>, 'activationRecord'>,
  appVersion: string,
  intent: OCCdUpdateIntent
): {
  census: OCCdTerminalCensus
  recountCensus: () => Promise<OCCdTerminalCensus>
  releaseIncumbentAdmission: () => Promise<void>
  censusRecord: OCCdActivationRecord
  admitRecord: (record: OCCdActivationRecord, candidateVersion: string) => string | null
} {
  // Only the active daemon can count sessions; guessing zero risks restarting live terminals.
  const census: OCCdTerminalCensus = context.activationRecord.active
    ? UNVERIFIABLE_OCCD_TERMINAL_CENSUS
    : { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
  return {
    census,
    recountCensus: async () => census,
    releaseIncumbentAdmission: async () => {},
    censusRecord: context.activationRecord,
    // Only the fenced read can reject newer migrated state or rolled-back builds on this unlinked path.
    admitRecord: admitOCCdRecordForIntent(intent, appVersion)
  }
}

// Force can override live terminal counts, never unknown census or protocol deferrals.
export function isForceableOCCdDeferral(code: string): boolean {
  return code === OCCD_UPDATE_TERMINALS_RUNNING_CODE
}
