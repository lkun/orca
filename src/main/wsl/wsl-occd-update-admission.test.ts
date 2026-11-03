import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OCCdActivationRecord } from '../managed-server/activation/occd-activation-record'
import { recordOCCdUpdateFailedThisLaunch } from '../managed-server/lifecycle/occd-managed-update-failure-memory'
import type { ServeReadiness } from '../server/serve-readiness'

import type { OCCdSlotOptions } from '../ssh/occd-recovery-slot'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'
import { admitWslOCCdUpdate } from './wsl-occd-update-admission'

const { adoptRunningOCCdVersion, readOCCdActivationRecord } = vi.hoisted(() => ({
  adoptRunningOCCdVersion: vi.fn(),
  readOCCdActivationRecord: vi.fn()
}))

vi.mock('../ssh/occd-running-version-adoption', () => ({ adoptRunningOCCdVersion }))
vi.mock('../managed-server/activation/occd-activation-record-store', () => ({
  readOCCdActivationRecord
}))

// Mixed versions between this desktop and a WSL distro's occd: they update independently.
const OLDER = '1.5.0+aaaaaaaaaaaa'
const NEWER = '1.6.0+bbbbbbbbbbbb'
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
let hostSeq = 0

function running(version: string, appVersion: string): OCCdActivationRecord {
  return {
    schemaVersion: 1,
    active: version,
    previous: null,
    activatedAt: '2026-10-01T00:00:00.000Z',
    snapshot: null,
    activeAppVersion: appVersion
  }
}

function admit(
  record: OCCdActivationRecord,
  desktop: { candidateVersion: string; appVersion: string },
  options: { intent?: 'connect' | 'update' | 'force'; host?: { kind: 'wsl'; id: string } } = {}
) {
  return admitWslOCCdUpdate({
    slot,
    record,
    ...desktop,
    host: options.host ?? { kind: 'wsl', id: `Ubuntu-${(hostSeq += 1)}` },
    intent: options.intent ?? 'connect'
  })
}

beforeEach(() => {
  adoptRunningOCCdVersion.mockReset()
  readOCCdActivationRecord.mockReset()
})

describe('WSL occd admission across desktop and host versions', () => {
  describe('an older desktop meets the occd a newer desktop deployed', () => {
    const olderDesktop = { candidateVersion: OLDER, appVersion: '1.5.0' }

    it('keeps the newer occd serving its terminals, with no Update hint', async () => {
      adoptRunningOCCdVersion.mockResolvedValue({ version: NEWER, readiness, reprobe: vi.fn() })
      for (const intent of ['connect', 'update'] as const) {
        expect(await admit(running(NEWER, '1.6.0'), olderDesktop, { intent })).toEqual({
          action: 'serve',
          version: NEWER,
          readiness,
          deferredUpdate: null
        })
      }
      expect(adoptRunningOCCdVersion).toHaveBeenCalledWith(slot, running(NEWER, '1.6.0'), OLDER)
    })
  })

  describe('a newer desktop meets the occd an older desktop deployed', () => {
    const newerDesktop = { candidateVersion: NEWER, appVersion: '1.6.0' }

    it('keeps the older occd serving after a failed update, and offers Force', async () => {
      const host = { kind: 'wsl' as const, id: 'Ubuntu-failed' }
      recordOCCdUpdateFailedThisLaunch(host, { code: 'occd_activation_failed', reason: 'boom' })
      adoptRunningOCCdVersion.mockResolvedValue({ version: OLDER, readiness, reprobe: vi.fn() })
      expect(await admit(running(OLDER, '1.5.0'), newerDesktop, { host })).toEqual({
        action: 'serve',
        version: OLDER,
        readiness,
        deferredUpdate: {
          candidateVersion: NEWER,
          code: 'occd_activation_failed',
          reason: 'boom',
          forceable: true
        }
      })
    })
  })
})
