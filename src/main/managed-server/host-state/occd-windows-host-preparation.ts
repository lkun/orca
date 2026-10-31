// Stage pinned Node and a content-addressed host script so Windows operations share verified bytes without replacing running clients' code.
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-environment'
import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { ensureRemoteOCCdNodeRuntime } from '../install/occd-remote-node-runtime'
import {
  installOCCdWindowsHostScript,
  occdRemoteBaseDir
} from '../install/occd-remote-windows-node'
import { materializeNodeRuntimeArchive } from '../../node-runtime/pinned-runtime-materializer'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

export async function prepareWindowsOCCdHost(options: {
  conn: OCCdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  serverTarget: NodeRuntimeTarget
  signal?: AbortSignal
}): Promise<void> {
  const baseDir = occdRemoteBaseDir(options.host, options.remoteHome)
  await ensureRemoteOCCdNodeRuntime({
    conn: options.conn,
    host: options.host,
    // The runtime store is a sibling of slots; only this synthetic slot's parent is used.
    slotDir: joinRemotePath(options.host, baseDir, 'occd-host'),
    target: options.serverTarget,
    archivePath: () =>
      materializeNodeRuntimeArchive(
        options.serverTarget,
        join(getAppEnvironment().getPath('userData'), 'occd-artifacts'),
        { signal: options.signal }
      ),
    signal: options.signal
  })
  await installOCCdWindowsHostScript(options, baseDir)
}
