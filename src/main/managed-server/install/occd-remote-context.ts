import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import type { SshTarget } from '../../../shared/ssh-types'
import type { OCCdActivationRecord } from '../activation/occd-activation-record'
import { readOCCdActivationRecord } from '../activation/occd-activation-record-store'
import { resolveOCCdRuntimeTarget } from '../lifecycle/occd-runtime-target'
import { LINUX_LIBC_FIRST_PROBE } from '../../node-runtime/linux-libc-probe'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { prepareWindowsOCCdHost } from '../host-state/occd-windows-host-preparation'
import {
  isWslOCCdHostTarget,
  type OCCdHostTarget,
  type OCCdHostTransport
} from '../../ssh/occd-host-transport'
import {
  decideOCCdMachineHome,
  occdMachineDataRoot,
  occdMachineHomeDir,
  occdMachineHomeProbeCommand,
  occdMachineOwnershipUnresolvedMessage,
  parseOCCdMachineHomeProbe
} from '../host-state/occd-machine-home'
import {
  occdMachineClaimCommand,
  readOCCdMachineClaimAnswer
} from '../host-state/occd-machine-claim-command'
import { execOCCdRemote, type OCCdRemoteExecTarget } from './occd-remote-runtime-control'
import { readRemoteHomeCommand } from '../../ssh/ssh-remote-commands'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  normalizeRemoteHome,
  validateRemoteHome,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/ssh-remote-platform-detection'
import { OCCdHostUnsupportedError } from '../../occd/occd-host-unavailable'
import { rememberSshHostPlatform } from '../../ssh/ssh-host-platform-memo'

/** Default SSH generic retains compatibility with lifecycle consumers requiring SSH-only fields. */
export type OCCdRemoteContext<Target extends OCCdHostTarget = SshTarget> = {
  activationRecord: OCCdActivationRecord
  /** Select a compatible runtime when host glibc is below the default pin's floor. */
  serverTarget: NodeRuntimeTarget
  connection: OCCdHostTransport
  host: RemoteHostPlatform
  /** Login or machine-specific home for shared-home isolation; userDataDir must follow the same owner. */
  remoteHome: string
  target: Target
  userDataDir: string
}

export async function resolveOCCdRemoteContext<Target extends OCCdHostTarget = SshTarget>(
  target: Target,
  connection: OCCdHostTransport,
  signal?: AbortSignal,
  detectedHost?: RemoteHostPlatform,
  /**
   * Facts the caller already read on this host. `loginHome` serves only login-home placement;
   * `firstLibcProbeOutput` answers the libc probe's first command, whose fallbacks still run.
   */
  known: {
    loginHome?: string
    firstLibcProbeOutput?: string
    /** Replaces the plain activation record read; WSL reads its connect snapshot here. */
    readActivationRecord?: (
      target: OCCdRemoteExecTarget & { remoteHome: string; userDataDir: string }
    ) => Promise<OCCdActivationRecord>
  } = {}
): Promise<OCCdRemoteContext<Target>> {
  const host = detectedHost ?? (await detectRemoteHostPlatform(connection, { signal }))
  if (!host) {
    throw new OCCdHostUnsupportedError(
      isWslOCCdHostTarget(target)
        ? 'OCC’s server doesn’t support this WSL distro’s platform. Use an x64 or arm64 Linux distro.'
        : 'OCC’s server doesn’t support this SSH host’s platform.'
    )
  }
  const remote = { conn: connection, host, signal }
  const { occdHome: remoteHome, userDataDir } = await resolveOCCdMachineHome(
    remote,
    !isWslOCCdHostTarget(target),
    known.loginHome
  )
  let firstLibcProbeOutput = known.firstLibcProbeOutput
  const serverTarget = await resolveOCCdRuntimeTarget({
    conn: connection,
    host,
    signal,
    ...(firstLibcProbeOutput === undefined
      ? {}
      : {
          exec: async (command: string) => {
            if (command === LINUX_LIBC_FIRST_PROBE && firstLibcProbeOutput !== undefined) {
              const output = firstLibcProbeOutput
              firstLibcProbeOutput = undefined
              return output
            }
            // The fallbacks run exactly as the default exec would.
            return execCommand(connection, command, { signal })
          }
        })
  })
  if (!isWslOCCdHostTarget(target)) {
    rememberSshHostPlatform(target.id, host, serverTarget)
  }
  if (isWindowsRemoteHost(host)) {
    // Prepare pinned Node before even reading activation state on Windows.
    await prepareWindowsOCCdHost({
      conn: connection,
      host,
      remoteHome,
      serverTarget,
      signal
    })
  }
  const activationRecord = await (known.readActivationRecord ?? readOCCdActivationRecord)({
    ...remote,
    remoteHome,
    userDataDir
  })
  return {
    activationRecord,
    serverTarget,
    connection,
    host,
    remoteHome,
    target,
    userDataDir
  }
}

/** Resolve per-machine state for shared POSIX homes; Windows and WSL retain login-home placement. */
export async function resolveOCCdMachineHome(
  remote: OCCdRemoteExecTarget,
  keyByMachine: boolean,
  knownLoginHome?: string
): Promise<{ loginHome: string; occdHome: string; userDataDir: string }> {
  const { host } = remote
  if (!keyByMachine || isWindowsRemoteHost(host)) {
    const loginHome = normalizeRemoteHome(
      knownLoginHome ?? (await execOCCdRemote(remote, readRemoteHomeCommand(host))),
      host
    )
    if (!validateRemoteHome(loginHome, host)) {
      throw new Error(`Remote home is not a valid path: ${loginHome.slice(0, 100)}`)
    }
    return {
      loginHome,
      occdHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.occ')
    }
  }
  const probe = parseOCCdMachineHomeProbe(
    await execOCCdRemote(remote, occdMachineHomeProbeCommand(host)),
    host
  )
  const { loginHome } = probe
  let decision = decideOCCdMachineHome(probe, host)
  if (decision.kind === 'unresolved') {
    throw new Error(
      occdMachineOwnershipUnresolvedMessage(
        decision.machineKey,
        probe.identity?.hostname ?? null,
        decision.cause
      )
    )
  }
  if (decision.kind === 'claim') {
    const won = readOCCdMachineClaimAnswer(
      await execOCCdRemote(remote, occdMachineClaimCommand(host, loginHome, decision.machineKey))
    )
    if (won.state !== 'present') {
      throw new Error(won.message)
    }
    decision =
      won.machineKey === decision.machineKey
        ? { kind: 'login-home' }
        : { kind: 'machine-home', machineKey: decision.machineKey }
  }
  if (decision.kind === 'login-home') {
    return {
      loginHome,
      occdHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.occ')
    }
  }
  const occdHome = occdMachineHomeDir(host, loginHome, decision.machineKey)
  await execOCCdRemote(remote, `umask 077; mkdir -p ${quotePosixShell(occdHome)}`)
  return {
    loginHome,
    occdHome,
    userDataDir: occdMachineDataRoot(host, loginHome, decision.machineKey)
  }
}
