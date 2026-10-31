import { NODE_RUNTIME_PIN } from './node-runtime-pin'
import type { OCCdPreflightRuntimeIdentity } from './occd-profile-preflight'

/** What a Node slot's candidate must report: the pinned runtime, never a host Node. */
export const OCCD_NODE_RUNTIME_IDENTITY: OCCdPreflightRuntimeIdentity = {
  runtime: 'node',
  runtimeVersion: NODE_RUNTIME_PIN.version
}
