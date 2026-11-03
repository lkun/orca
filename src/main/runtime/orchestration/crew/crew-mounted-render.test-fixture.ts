import { CrewReadModel } from './crew-read-model'
import { fixture } from './crew-read-model.test-fixture'
import { subscribeCrew } from './crew-stream'
import { agentSessionRecordFixture } from '../../../native-chat/agent-session-record-test-fixture'
import { agentSessionConversationView } from '../../../../shared/agent-session/lifecycle/agent-session-conversation-view'
import { testOCCSessionId } from '../../../../shared/occ-session-address-test-fixture'
import { formatOCCSessionAddress } from '../../../../shared/occ-session-address'
import type { MountedCrewProducerModule } from '../../../../shared/orchestration-crew-mounted.test-fixture'

export const createMountedCrewProducer: MountedCrewProducerModule['createMountedCrewProducer'] =
  () => {
    const f = fixture()
    const sessionId = testOCCSessionId('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')
    const address = formatOCCSessionAddress(sessionId)
    const record = agentSessionConversationView(agentSessionRecordFixture({ sessionId }))
    f.deps.records = {
      listRecords: () => [record],
      getRecord: (id) => (id === sessionId ? record : null),
      getVisibleSessionTabIndex: () => ({ present: true, sessionIds: [sessionId] })
    }
    f.db.insertMessage({ from: address, to: 'term_worker', subject: 'Peer', body: 'Retained L' })
    f.db.insertMessage({ from: 'term_peer', to: 'term_helper', subject: 'Other', body: 'Other L' })
    const model = new CrewReadModel(() => f.deps, f.db.crewChanges.subscribe)
    return {
      address,
      subscribe: (party, emit) => subscribeCrew(() => model.read(party), model.subscribe, emit),
      removeAddress: () => {
        for (let index = 0; index < 2; index++) {
          f.db.createRun({
            objective: 'Remembered owner',
            coordinatorHandle: null,
            coordinatorPaneKey: null,
            coordinatorOCCSessionId: sessionId
          })
        }
        f.db.unbindOtherRunsForCoordinator(
          {
            terminalHandle: null,
            paneKey: null,
            occSessionId: sessionId
          },
          f.run.id
        )
      }
    }
  }
