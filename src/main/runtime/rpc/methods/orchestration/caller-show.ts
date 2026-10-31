import type {
  OrchestrationCallerShowResult,
  OrchestrationPartyLocationResult,
  OrchestrationSessionAddressResult
} from '../../../../../shared/orchestration-caller-status'
import {
  formatOCCSessionAddress,
  isOCCSessionId
} from '../../../../../shared/occ-session-address'
import { ORCHESTRATION_SESSION_CALLER_ERROR_CODES as CODES } from '../../../../../shared/orchestration-session-caller-codes'
import {
  PartyLocationParams,
  SessionAddressParams
} from '../../../../../shared/rpc-contract/orchestration-params'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import { resolveOCCSessionParty } from '../../../orchestration/orchestration-party'
import { locateOrchestrationParty } from '../../../orchestration/orchestration-party-location'
import { readAgentSessionRecordStore } from '../../../orchestration/structured-session-lineage'
import { defineMethod } from '../../core'

export const ORCHESTRATION_CALLER_METHODS = [
  defineMethod({
    name: 'orchestration.callerShow',
    permission: 'workspace',
    params: null,
    // Dispatch already admitted the environment's session; do not resolve another caller from params.
    handler: (_params, { orchestrationCaller }): OrchestrationCallerShowResult => ({
      caller: orchestrationCaller
        ? { occSessionId: formatOCCSessionAddress(orchestrationCaller.occSessionId), live: true }
        : null
    })
  }),
  defineMethod({
    name: 'orchestration.sessionAddress',
    permission: 'workspace',
    params: SessionAddressParams,
    // Only host records know the chat's /clear root.
    handler: (params, { runtime }): OrchestrationSessionAddressResult => {
      if (!isOCCSessionId(params.sessionId)) {
        throw new OrchestrationError(
          CODES.unknown,
          `${params.sessionId} is not an OCC session ID.`,
          { effectsApplied: false }
        )
      }
      const party = resolveOCCSessionParty(params.sessionId, runtime.getOrchestrationDb())
      return { occSessionId: formatOCCSessionAddress(party.occSessionId) }
    }
  }),
  defineMethod({
    name: 'orchestration.partyLocation',
    permission: 'workspace',
    params: PartyLocationParams,
    // Resolve the chat sender's live /clear successor on its owning host.
    handler: (params, { runtime }): OrchestrationPartyLocationResult =>
      locateOrchestrationParty(
        params.address,
        {
          db: runtime.getOrchestrationDb(),
          records: readAgentSessionRecordStore(),
          terminalPaneKey: (handle) => runtime.getTerminalPaneKey(handle),
          terminalHandleForPaneKey: (paneKey) => runtime.getTerminalHandleForPaneKey(paneKey)
        },
        params.messageIds
      )
  })
]
