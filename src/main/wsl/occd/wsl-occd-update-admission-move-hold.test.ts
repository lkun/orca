import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OCCD_UPDATE_WSL_MOVE_RUNNING_CODE } from '../../../shared/wsl-host-types'
import type { OCCdActivationRecord } from '../../managed-server/activation/occd-activation-record'
import type { ServeReadiness } from '../../server/serve-readiness'
import type { OCCdSlotOptions } from '../../ssh/occd-recovery-slot'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { admitWslOCCdUpdate } from './wsl-occd-update-admission'

const { adoptRunningOCCdVersion } = vi.hoisted(() => ({ adoptRunningOCCdVersion: vi.fn() }))

vi.mock('../../ssh/occd-running-version-adoption', () => ({ adoptRunningOCCdVersion }))
vi.mock('../../managed-server/activation/occd-activation-record-store', () => ({
  readOCCdActivationRecord: vi.fn()
}))

const RUNNING = '1.5.0+aaaaaaaaaaaa'
const BUNDLED = '1.6.0+bbbbbbbbbbbb'
const slot: OCCdSlotOptions = {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every host call is mocked at its module.
  conn: {} as OCCdSlotOptions['conn'],
  host: getRemoteHostPlatform('linux-x64'),
  remoteHome: '/home/u',
  nodePath: '',
  userDataDir: '/home/u/.occ',
  bindHost: '127.0.0.1',
  port: 6768
}
const readiness: ServeReadiness = {
  runtimeId: 'wsl-runtime',
  boundEndpoint: '127.0.0.1:6768',
  advertisedEndpoint: null,
  managedWslCliReconciliation: 'settled',
  pairing: { available: false, reason: 'disabled_by_operator', guidance: '' }
}
const record: OCCdActivationRecord = {
  schemaVersion: 1,
  active: RUNNING,
  previous: null,
  activatedAt: '2026-10-01T00:00:00.000Z',
  snapshot: null,
  activeAppVersion: '1.5.0'
}
let hostSeq = 0

function admit(intent: 'connect' | 'update' | 'force', moveRunning: boolean) {
  return admitWslOCCdUpdate({
    slot,
    record,
    candidateVersion: BUNDLED,
    appVersion: '1.6.0',
    host: { kind: 'wsl', id: `Ubuntu-${(hostSeq += 1)}` },
    intent,
    moveRunning
  })
}

beforeEach(() => {
  adoptRunningOCCdVersion.mockReset()
  adoptRunningOCCdVersion.mockResolvedValue({ version: RUNNING, readiness, reprobe: vi.fn() })
})

describe('a WSL occd update while a project moves onto the host', () => {
  it.each(['connect', 'update', 'force'] as const)(
    'keeps the running server for the move on %s, and says the update waits for it',
    async (intent) => {
      expect(await admit(intent, true)).toEqual({
        action: 'serve',
        version: RUNNING,
        readiness,
        deferredUpdate: {
          candidateVersion: BUNDLED,
          code: OCCD_UPDATE_WSL_MOVE_RUNNING_CODE,
          reason: expect.stringContaining('once the move finishes'),
          forceable: false
        }
      })
    }
  )

  it('updates as before once no move runs', async () => {
    expect(await admit('connect', false)).toEqual({ action: 'deploy', record })
    expect(adoptRunningOCCdVersion).not.toHaveBeenCalled()
  })
})
