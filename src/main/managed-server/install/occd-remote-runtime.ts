import {
  OCCD_BUILD_TARGET_FILENAME,
  OCCD_LAUNCHER_FILENAME,
  OCCD_SERVER_ENTRY_FILENAME,
  OCCD_NODE_RUNTIME_DIR_PREFIX,
  OCCD_NODE_RUNTIME_MARKER_FILENAME,
  OCCD_NODE_RUNTIME_POSIX_EXECUTABLE,
  OCCD_RUNTIMES_DIRNAME,
  occdBunRuntimeFilename
} from '../../../shared/occd-artifacts'
import { assertPosixOCCdHost } from './occd-remote-host-support'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

// Assign the long slot path once to reduce command size on the wire.
function assignOCCdSlot(directory: string): string {
  return `occd_slot=${quotePosixShell(directory.replace(/\/+$/, ''))}; `
}

// Rollback must still accept legacy single-entry slots.
export function selectOCCdSlotEntryCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixOCCdHost(host)
  const server = `"$occd_slot"/${quotePosixShell(OCCD_SERVER_ENTRY_FILENAME)}`
  const launcher = `"$occd_slot"/${quotePosixShell(OCCD_LAUNCHER_FILENAME)}`
  return `${assignOCCdSlot(directory)}if [ -f ${server} ]; then occd_entry=${server}; else occd_entry=${launcher}; fi`
}

/** Set $occd_runtime or exit 78; callers decide what an absent marker means. */
export function occdNodeSlotRuntimeCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixOCCdHost(host)
  const nodeMarker = `"$occd_slot"/${quotePosixShell(OCCD_NODE_RUNTIME_MARKER_FILENAME)}`
  const nodeRuntimePrefix = `"\${occd_slot%/*}"/${quotePosixShell(
    `${OCCD_RUNTIMES_DIRNAME}/${OCCD_NODE_RUNTIME_DIR_PREFIX}`
  )}`
  const nodeExecutable = quotePosixShell(`/${OCCD_NODE_RUNTIME_POSIX_EXECUTABLE}`)
  return (
    `${assignOCCdSlot(directory)}occd_node_sha=$(cat ${nodeMarker}) || exit 78; ` +
    // The digest becomes a path segment; reject non-SHA256 values.
    // Leading ( keeps the case pattern parseable inside command substitution.
    'case "$occd_node_sha" in ("" | *[!0-9a-f]*) exit 78;; esac; ' +
    '[ "${#occd_node_sha}" -eq 64 ] || exit 78; ' +
    `occd_runtime=${nodeRuntimePrefix}"$occd_node_sha"${nodeExecutable}; ` +
    '[ -x "$occd_runtime" ] || exit 78; '
  )
}

/** Legacy host Node fallback must never hide an incomplete Node or Bun slot. */
export function selectOCCdSlotRuntimeCommand(
  host: RemoteHostPlatform,
  directory: string,
  legacyNodePath: string
): string {
  assertPosixOCCdHost(host)
  const nodeMarker = quotePosixShell(
    joinRemotePath(host, directory, OCCD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const runtime = quotePosixShell(joinRemotePath(host, directory, occdBunRuntimeFilename(host.os)))
  const target = quotePosixShell(joinRemotePath(host, directory, OCCD_BUILD_TARGET_FILENAME))
  return (
    `if [ -e ${nodeMarker} ]; then ${occdNodeSlotRuntimeCommand(host, directory)}` +
    `elif [ -e ${target} ] || [ -e ${runtime} ]; then ` +
    `[ -x ${runtime} ] || exit 78; occd_runtime=${runtime}; ` +
    `else occd_runtime=${quotePosixShell(legacyNodePath)}; fi`
  )
}
