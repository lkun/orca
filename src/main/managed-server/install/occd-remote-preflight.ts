import { randomUUID } from 'node:crypto'
import { OCCD_NODE_RUNTIME_IDENTITY } from '../../../shared/occd-node-runtime-identity'
import { OCCD_NODE_RUNTIME_MARKER_FILENAME } from '../../../shared/occd-artifacts'
import {
  OCCD_PROFILE_PREFLIGHT_FLAG,
  OCCD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseOCCdProfilePreflight,
  type OCCdProfilePreflightResponse
} from '../../../shared/occd-profile-preflight'
import { assertPosixOCCdHost } from './occd-remote-host-support'
import {
  occdWindowsNodeCommandLine,
  occdWindowsSlotOpCommand,
  readOCCdWindowsEncodedAnswer
} from './occd-remote-windows-node'
import { readWindowsOCCdSlotEntry } from './occd-remote-launch-windows'
import { OCCD_WINDOWS_RUNTIME_MARKER } from '../host-state/occd-windows-host-script'
import { occdNodeSlotRuntimeCommand, selectOCCdSlotEntryCommand } from './occd-remote-runtime'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'

export function occdProfilePreflightCommand(
  host: RemoteHostPlatform,
  directory: string,
  nonce: string,
  probeDaemonsUnder?: string
): string {
  assertPosixOCCdHost(host)
  // New candidates always use pinned Node; host Node fallback could mask an incomplete slot.
  const marker = quotePosixShell(
    joinRemotePath(host, directory, OCCD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const launch = [
    'OCC_BACKGROUND_LAUNCH=1',
    '"$occd_runtime"',
    '"$occd_entry"',
    OCCD_PROFILE_PREFLIGHT_FLAG,
    quotePosixShell(nonce),
    ...(probeDaemonsUnder === undefined ? [] : [quotePosixShell(probeDaemonsUnder)])
  ].join(' ')
  return `[ -e ${marker} ] || exit 78; ${occdNodeSlotRuntimeCommand(host, directory)}${selectOCCdSlotEntryCommand(host, directory)}; ${launch}`
}

/** Qualify the candidate; given the served data root, it also names the daemon generations alive there. */
export async function preflightInstalledOCCd(options: {
  conn: OCCdHostTransport
  host: RemoteHostPlatform
  remoteInstallDir: string
  probeDaemonsUnder?: string
  fullVersion: string
  signal?: AbortSignal
}): Promise<OCCdProfilePreflightResponse> {
  const nonce = randomUUID()
  const command = isWindowsRemoteHost(options.host)
    ? await windowsOCCdProfilePreflightCommand(options, nonce)
    : occdProfilePreflightCommand(
        options.host,
        options.remoteInstallDir,
        nonce,
        options.probeDaemonsUnder
      )
  const output = await execCommand(options.conn, command, {
    signal: options.signal,
    timeoutMs: OCCD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    wrapCommand: !isWindowsRemoteHost(options.host)
  })
  return parseOCCdProfilePreflight(output, nonce, OCCD_NODE_RUNTIME_IDENTITY, options.fullVersion)
}

// Windows uses plain argv; occd opens no window and needs no background-launch environment.
async function windowsOCCdProfilePreflightCommand(
  options: {
    conn: OCCdHostTransport
    host: RemoteHostPlatform
    remoteInstallDir: string
    probeDaemonsUnder?: string
    signal?: AbortSignal
  },
  nonce: string
): Promise<string> {
  const { host, remoteInstallDir } = options
  const slotAnswer = await execCommand(
    options.conn,
    occdWindowsSlotOpCommand(host, remoteInstallDir, 'slot-runtime', [remoteInstallDir]),
    { signal: options.signal, wrapCommand: false }
  )
  const runtime = readOCCdWindowsEncodedAnswer(slotAnswer, OCCD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this occd slot needs.')
  }
  return occdWindowsNodeCommandLine(runtime, [
    readWindowsOCCdSlotEntry(slotAnswer, host, remoteInstallDir),
    OCCD_PROFILE_PREFLIGHT_FLAG,
    nonce,
    ...(options.probeDaemonsUnder === undefined ? [] : [options.probeDaemonsUnder])
  ])
}
