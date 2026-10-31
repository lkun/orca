import type { DispatchCreator } from '../../../../orchestration/db/dispatch-depth'
import type { OrchestrationSessionCaller } from '../../../../orchestration/orchestration-caller-identity'
import type { OCCRuntimeService } from '../../../../occ-runtime'
import { orchestrationCallerIdentity } from './run-scope'

/** Use runtime-attested pane/incarnation for nesting identity; remote attachment matching requires the exact process and params are untrusted. */
export function resolveDispatchCreator(
  runtime: OCCRuntimeService,
  callerHandle: string | undefined,
  callerSession: OrchestrationSessionCaller | undefined
): DispatchCreator {
  if (!callerHandle) {
    // No declared caller resolves no parent; retain legacy Run-binding depth zero.
    return { kind: 'system' }
  }
  const caller = orchestrationCallerIdentity(runtime, {
    handle: callerHandle,
    session: callerSession,
    paneKey: null
  })
  if (caller.terminalHandle === null) {
    // A handle-less session: its OCC session id is its whole identity.
    return caller.occSessionId
      ? { kind: 'session', occSessionId: caller.occSessionId }
      : { kind: 'system' }
  }
  const authority = runtime.getOrchestrationDispatchAuthority?.(caller.terminalHandle)
  return {
    kind: 'terminal',
    handle: caller.terminalHandle,
    paneKey:
      authority?.paneKey ??
      caller.paneKey ??
      runtime.getTerminalPaneKey(caller.terminalHandle) ??
      undefined,
    processIncarnation: authority?.processIncarnation ?? undefined,
    ...(caller.occSessionId ? { occSessionId: caller.occSessionId } : {})
  }
}
