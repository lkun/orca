// Preferred ports may belong to other runtimes; tunnel to the active slot's published bound port.
import {
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import type { ServeReadiness } from '../../server/serve-readiness'
import { managedOCCdInstallDir } from './occd-managed-runtime-context'
import { resolveOCCdRemoteContext } from '../install/occd-remote-context'
import {
  parseOCCdReadinessWaitOutput,
  readOCCdReadinessNowCommand
} from '../install/occd-remote-readiness-wait'
import {
  execOCCdRemote,
  type OCCdRemoteExecTarget
} from '../install/occd-remote-runtime-control'
import type { OCCdHostTarget, OCCdHostTransport } from '../../ssh/occd-host-transport'
import { parsePairingCode } from '../../../shared/remote-runtime/pairing/pairing'

export type OCCdTunnelPortInput = {
  environment: KnownRuntimeEnvironment
  target: SshTarget
  connection: OCCdHostTransport
}

export function occdBoundPort(readiness: Pick<ServeReadiness, 'boundEndpoint'>): number | null {
  if (!readiness.boundEndpoint) {
    return null
  }
  try {
    const port = Number(new URL(readiness.boundEndpoint).port)
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null
  } catch {
    return null
  }
}

async function readManagedOCCdSlotReadiness(
  target: OCCdRemoteExecTarget & { remoteInstallDir: string }
): Promise<ServeReadiness | null> {
  const parsed = parseOCCdReadinessWaitOutput(
    target.host,
    await execOCCdRemote(
      target,
      readOCCdReadinessNowCommand(target.host, target.remoteInstallDir)
    )
  )
  return parsed.state === 'ready' ? parsed.readiness : null
}

export async function readActiveManagedOCCdReadiness(input: {
  target: OCCdHostTarget
  connection: OCCdHostTransport
}): Promise<ServeReadiness | null> {
  const context = await resolveOCCdRemoteContext(input.target, input.connection)
  const active = context.activationRecord.active
  if (!active) {
    return null
  }
  return readManagedOCCdSlotReadiness({
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    remoteInstallDir: managedOCCdInstallDir(context, active)
  })
}

async function readActiveSlotBoundPort(input: OCCdTunnelPortInput): Promise<number | null> {
  if (!input.environment.occdDeployment) {
    return null
  }
  const readiness = await readActiveManagedOCCdReadiness(input)
  return readiness ? occdBoundPort(readiness) : null
}

export async function resolveManagedOCCdTunnelPort(input: OCCdTunnelPortInput): Promise<number> {
  const access = getRuntimeSshAccess(input.environment)
  if (!access) {
    throw new Error('Managed occd environment is missing its SSH tunnel dependency.')
  }
  try {
    return (await readActiveSlotBoundPort(input)) ?? access.remotePort
  } catch (error) {
    // Post-forward identity validation still detects a wrong server when falling back.
    console.warn(
      '[ssh] Could not read the managed OCC server port; trying the preferred one:',
      error
    )
    return access.remotePort
  }
}

/** Missing or unreadable published ports never justify moving an existing tunnel. */
export async function readManagedOCCdPublishedPort(
  input: OCCdTunnelPortInput
): Promise<number | null> {
  try {
    return await readActiveSlotBoundPort(input)
  } catch {
    return null
  }
}

/** The server key the active slot offers to new pairings; null when unpublished or unreadable. */
export async function readManagedOCCdPublishedKey(
  input: OCCdTunnelPortInput
): Promise<string | null> {
  if (!input.environment.occdDeployment) {
    return null
  }
  try {
    const readiness = await readActiveManagedOCCdReadiness(input)
    return readiness?.pairing.available
      ? (parsePairingCode(readiness.pairing.url)?.publicKeyB64 ?? null)
      : null
  } catch {
    return null
  }
}
