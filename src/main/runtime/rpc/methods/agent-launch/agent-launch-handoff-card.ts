import type { AgentLaunchResult } from '../../../../../shared/agent-launch/contracts/agent-launch-intent'
import { isOCCSessionId } from '../../../../../shared/occ-session-address'

import { OCC_SESSION_ADDRESS_PREFIX } from '../../../../../shared/occ-session-address-prefix'
import type { AgentLaunchParams } from '../../../../../shared/rpc-contract/agent-launch-params'
import {
  prepareAgentCreationCard,
  startedAgentSender
} from '../../../orchestration/workers/launch/worker-start-card'
import type { RpcContext } from '../../core'
import { isAgentRpcCaller } from '../../rpc-caller-identity'

/** An agent that hands work to another from its chat leaves a card there linking to it.
 *  Display bookkeeping: nothing here refuses, holds or fails the launch, whose result passes through. */
export function prepareAgentHandoffCard(
  params: AgentLaunchParams & { operationId: string },
  context: RpcContext
): (result: AgentLaunchResult) => AgentLaunchResult {
  const record = prepareHandoffRecord(params, context)
  return (result) => {
    record(result)
    return result
  }
}

function prepareHandoffRecord(
  params: AgentLaunchParams & { operationId: string },
  context: RpcContext
): (result: AgentLaunchResult) => void {
  // Only the occ CLI on this host names its chat; windows, phones and remote CLIs launch for a person.
  const callerSessionId = context.orchestrationCompatibilityEvidence?.agentSessionId
  if (
    !isAgentRpcCaller(context.caller) ||
    callerSessionId === undefined ||
    !isOCCSessionId(callerSessionId)
  ) {
    return () => {}
  }
  const publish = prepareAgentCreationCard(callerSessionId)
  if (!publish) {
    return () => {}
  }
  return ({ outcome, prompt }) => {
    // The agent exists either way; the card shows a task only once it was sent to that agent.
    const task =
      params.prompt?.delivery === 'submit' && prompt?.outcome !== 'not-delivered'
        ? params.prompt.text
        : ''
    const address =
      outcome.kind === 'structured'
        ? `${OCC_SESSION_ADDRESS_PREFIX}${outcome.sessionId}`
        : outcome.handle
    publish(() => ({
      kind: 'agent-handoff',
      launchId: params.operationId,
      agent: startedAgentSender(context.runtime, address, params.agent),
      task
    }))
  }
}
