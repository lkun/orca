import type { OCCdHostTransport } from './occd-host-transport'
import type { SshConnection } from './connection/ssh-connection'

/** Return the connection object itself: tunnel ownership, dedupe and caches depend on its identity. */
export function sshOCCdHostTransport(connection: SshConnection): OCCdHostTransport {
  return connection
}
