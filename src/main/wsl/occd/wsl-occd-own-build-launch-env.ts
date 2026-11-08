import { hostMallocTunablesLaunchEnv } from '../../memory/host-malloc-tunables'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'

/** An older slot would leak GLIBC_TUNABLES to user shells, so only this build's own slot gets it. */
export function withOwnBuildLaunchEnv<T extends OCCdHostTransport>(
  conn: T,
  ownBuildVersion: () => string | null
): T {
  const occdLaunchEnv: OCCdHostTransport['occdLaunchEnv'] = async (launch) => [
    ...((await conn.occdLaunchEnv?.(launch)) ?? []),
    ...(launch.fullVersion === ownBuildVersion() ? hostMallocTunablesLaunchEnv() : [])
  ]
  // Delegate rather than spread so prototype methods survive; #private fields would still need explicit forwarding.
  return Object.create(conn, { occdLaunchEnv: { value: occdLaunchEnv } })
}
