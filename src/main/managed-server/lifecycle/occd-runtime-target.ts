import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { resolveOCCdDeploymentTargetFacts } from '../../ssh/occd-deployment-target'
import { OCCdHostUnsupportedError } from '../../occd/occd-host-unavailable'
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import { pinnedRuntimeTargetForHost } from '../../ssh/pinned-runtime-host-target'
import type { RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

/** Lets a caller that knows the host kind add its own fix; the message is the one SSH shows. */
export class OCCdHostGlibcUnsupportedError extends OCCdHostUnsupportedError {
  constructor(target: string, glibc: string) {
    super(`No OCC runtime supports ${target} with glibc ${glibc}.`)
  }
}

export async function resolveOCCdRuntimeTarget(options: {
  conn: OCCdHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  exec?: (command: string) => Promise<string>
}): Promise<NodeRuntimeTarget> {
  const facts = await resolveOCCdDeploymentTargetFacts(options)
  const target = pinnedRuntimeTargetForHost(facts)
  if (!target) {
    const glibc = facts.glibc ? `${facts.glibc.major}.${facts.glibc.minor}` : 'unknown'
    throw new OCCdHostGlibcUnsupportedError(facts.target, glibc)
  }
  return target
}
