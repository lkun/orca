import {
  OCCD_NODE_RUNTIME_DIR_PREFIX,
  OCCD_NODE_RUNTIME_POSIX_EXECUTABLE,
  OCCD_RUNTIMES_DIRNAME
} from '../../../shared/occd-artifacts'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import { OCCD_MACHINE_HOMES_DIRNAME } from '../host-state/occd-machine-home'

/** POSIX shell glob words for occd's pinned Node runtimes; machine homes may hold other architectures, so callers must self-test each match. */
export function occdPosixNodeRuntimeGlobs(): [string, string] {
  const store = `${RELAY_REMOTE_DIR}/${OCCD_RUNTIMES_DIRNAME}/${OCCD_NODE_RUNTIME_DIR_PREFIX}`
  const executable = `/${OCCD_NODE_RUNTIME_POSIX_EXECUTABLE}`
  const machineStores = `${RELAY_REMOTE_DIR}/${OCCD_MACHINE_HOMES_DIRNAME}/`
  return [
    `"$HOME"/${quotePosixShell(store)}*${quotePosixShell(executable)}`,
    `"$HOME"/${quotePosixShell(machineStores)}*/${quotePosixShell(store)}*${quotePosixShell(executable)}`
  ]
}
