import { formatOCCSessionAddress, isOCCSessionId } from '../../../shared/occ-session-address'
import type { OrchestrationSessionAddressResult } from '../../../shared/orchestration-caller-status'
import { callRuntimeRpc } from './runtime-rpc-client'
import { RuntimeRpcCallError } from './runtime-rpc-result'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'

/**
 * A chat's OCC session ID: its `/clear` root's, which the host derives from the session records.
 * Null for an id that is not an OCC session id.
 */
export async function resolveStructuredSessionOCCSessionId(
  target: RuntimeClientTarget,
  sessionId: string
): Promise<string | null> {
  if (!isOCCSessionId(sessionId)) {
    return null
  }
  try {
    const result = await callRuntimeRpc<OrchestrationSessionAddressResult>(
      target,
      'orchestration.sessionAddress',
      { sessionId }
    )
    return result.occSessionId
  } catch (error) {
    // Why: a host that predates the method routes the current session's ID to the same chat.
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      return formatOCCSessionAddress(sessionId)
    }
    throw error
  }
}
