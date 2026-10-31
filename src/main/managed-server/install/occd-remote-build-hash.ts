import { OCCD_LAUNCHER_FILENAME } from '../../../shared/occd-artifacts'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { execOCCdRemote, type OCCdRemoteExecTarget } from './occd-remote-runtime-control'
import { occdWindowsSlotOpCommand } from './occd-remote-windows-node'
import { OCCD_BUILD_HASH_MARKER as BUILD_HASH_MARKER } from '../host-state/occd-windows-host-script'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'

export async function readRemoteOCCdBuildHash(
  target: OCCdRemoteExecTarget,
  remoteInstallDir: string
): Promise<string> {
  const output = await execOCCdRemote(
    target,
    remoteOCCdBuildHashCommand(target.host, remoteInstallDir)
  )
  const match = output.match(new RegExp(`${BUILD_HASH_MARKER}\\s+([a-fA-F0-9]{16})`, 'u'))
  if (!match?.[1]) {
    throw new Error('Could not verify the installed occd build hash.')
  }
  return match[1].toLowerCase()
}

export function remoteOCCdBuildHashCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  if (isWindowsRemoteHost(host)) {
    return occdWindowsSlotOpCommand(host, remoteInstallDir, 'build-hash', [
      joinRemotePath(host, remoteInstallDir, OCCD_LAUNCHER_FILENAME)
    ])
  }
  const path = quotePosixShell(joinRemotePath(host, remoteInstallDir, OCCD_LAUNCHER_FILENAME))
  // GNU/BusyBox provide sha256sum, macOS shasum; both print the digest first.
  return [
    `[ -f ${path} ] && [ -r ${path} ] || exit 1;`,
    `occ_hash=$(if command -v sha256sum >/dev/null 2>&1; then sha256sum ${path} | awk '{print $1}';`,
    `elif command -v shasum >/dev/null 2>&1; then shasum -a 256 ${path} | awk '{print $1}'; fi);`,
    `case "$occ_hash" in [0-9a-fA-F][0-9a-fA-F]*) printf '%s %.16s\\n' ${quotePosixShell(BUILD_HASH_MARKER)} "$occ_hash";; esac`
  ].join(' ')
}
