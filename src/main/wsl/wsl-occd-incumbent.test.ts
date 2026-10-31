import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { encodePairingOffer, parsePairingCode } from '../../shared/pairing'
import { pairedRuntimeConnectionToken } from '../../shared/paired-runtime-connection'
import { DeviceRegistry } from '../runtime/device-registry'
import { OCCD_UPDATE_ADMISSION_FENCE_MS } from '../../shared/occd-terminal-census'
import { emptyOCCdActivationRecord } from '../managed-server/activation/occd-activation-record'
import type { OCCdRemoteContext } from '../managed-server/install/occd-remote-context'
import type { ServeReadiness } from '../server/serve-readiness'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'
import type { StartedPortForward } from '../ssh/port-forwarding/ssh-port-forward-provider'
import { readWslOCCdIncumbent, type WslOCCdIncumbentDependencies } from './wsl-occd-incumbent'
import type { WslOCCdHostTarget } from './wsl-occd-host-target'
import { unusedOCCdHostTransport } from '../ssh/unused-host-transport.test-fixture'

const host = getRemoteHostPlatform('linux-x64')
const KEY = Buffer.alloc(32, 7).toString('base64')
const READINESS: ServeReadiness = {
  runtimeId: 'r-old',
  boundEndpoint: 'ws://127.0.0.1:6791',
  advertisedEndpoint: null,
  managedWslCliReconciliation: 'settled' as const,
  pairing: {
    available: true as const,
    url: encodePairingOffer({
      v: 2,
      endpoint: 'ws://127.0.0.1:6791',
      deviceToken: 'device',
      publicKeyB64: KEY
    }),
    endpoint: 'ws://127.0.0.1:6791',
    deviceId: 'device-id',
    webClientUrl: null,
    scope: 'runtime' as const,
    qr: null
  }
}
const LIVE = {
  liveSessions: 1,
  startedSinceActivation: 0,
  daemonProtocolVersion: 3
}
const UNVERIFIABLE = {
  liveSessions: null,
  startedSinceActivation: null,
  daemonProtocolVersion: null
}
const target: WslOCCdHostTarget = {
  kind: 'wsl',
  id: 'wsl:ubuntu',
  distro: 'Ubuntu',
  label: 'Ubuntu'
}
const conn = unusedOCCdHostTransport()

function context(active: string | null = '1.4.0+aa'): OCCdRemoteContext<WslOCCdHostTarget> {
  return {
    activationRecord: {
      ...emptyOCCdActivationRecord(),
      active,
      activatedAt: active ? '2026-10-12T01:00:00.000Z' : null
    },
    serverTarget: 'linux-x64-glibc',
    connection: conn,
    host,
    remoteHome: '/home/u',
    target,
    userDataDir: '/home/u/.occ'
  }
}

const slot = {
  conn,
  host,
  remoteHome: '/home/u',
  nodePath: '',
  userDataDir: '/home/u/.occ',
  bindHost: '127.0.0.1',
  port: 6768
}

function dependencies(overrides: Partial<WslOCCdIncumbentDependencies> = {}) {
  const close = vi.fn(async () => {})
  const deps: WslOCCdIncumbentDependencies = {
    wake: vi.fn(async () => ({ outcome: 'serving' as const })),
    probe: vi.fn(async () => READINESS),
    readBuildHash: vi.fn(async () => '0123456789abcdef'),
    listen: vi.fn(async () => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only entry.localPort and close are read.
      return {
        entry: { localPort: 51000 },
        close
      } as unknown as StartedPortForward
    }),
    census: vi.fn(async () => LIVE),
    ...overrides
  }
  return { deps, close }
}

describe('readWslOCCdIncumbent', () => {
  it('asks a serving incumbent over a bridge to its bound port, then closes the bridge', async () => {
    const { deps, close } = dependencies()
    await expect(readWslOCCdIncumbent({ context: context(), slot }, deps)).resolves.toMatchObject({
      census: LIVE,
      readiness: READINESS
    })
    expect(deps.probe).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteInstallDir: '/home/u/.occ-remote/occd-1.4.0+aa'
      }),
      { buildHash: '0123456789abcdef', fullVersion: '1.4.0+aa' }
    )
    expect(deps.listen).toHaveBeenCalledWith(conn, 6791, target)
    const [connection, activatedAt, , options] = vi.mocked(deps.census).mock.calls[0]
    expect(connection.endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:51000\/?$/u)
    expect(activatedAt).toBe(Date.parse('2026-10-12T01:00:00.000Z'))
    expect(options).toEqual({ releaseFinishedAutomationTerminals: true })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('recounts over a fresh bridge without waking anything again', async () => {
    const { deps, close } = dependencies()
    const incumbent = await readWslOCCdIncumbent({ context: context(), slot }, deps)
    vi.mocked(deps.census).mockResolvedValueOnce({ ...LIVE, liveSessions: 3 })
    await expect(incumbent.recount()).resolves.toMatchObject({ liveSessions: 3 })
    expect(deps.wake).toHaveBeenCalledTimes(1)
    expect(deps.listen).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
    // Only final recount closes admission, preventing terminal creation between census and stop.
    expect(vi.mocked(deps.census).mock.calls[1]?.[3]).toEqual({
      releaseFinishedAutomationTerminals: true,
      closeAdmissionForMs: OCCD_UPDATE_ADMISSION_FENCE_MS
    })
    await incumbent.releaseAdmission()
    expect(vi.mocked(deps.census).mock.calls[2]?.[3]).toEqual({ closeAdmissionForMs: 0 })
  })

  // After a reboot the woken incumbent's daemon starts empty, so the census proves zero.
  it('wakes an incumbent a reboot stopped and reads it without probing again', async () => {
    const { deps } = dependencies({
      wake: vi.fn(async () => ({
        outcome: 'started' as const,
        readiness: READINESS
      })),
      census: vi.fn(async () => ({
        liveSessions: 0,
        startedSinceActivation: 0,
        daemonProtocolVersion: 3
      }))
    })
    await expect(readWslOCCdIncumbent({ context: context(), slot }, deps)).resolves.toMatchObject({
      census: { liveSessions: 0 },
      readiness: READINESS
    })
    expect(deps.probe).not.toHaveBeenCalled()
  })

  it('is unverifiable, without a bridge, when the incumbent cannot be proven running', async () => {
    const { deps } = dependencies({
      wake: vi.fn(async () => ({ outcome: 'unverifiable' as const }))
    })
    const incumbent = await readWslOCCdIncumbent({ context: context(), slot }, deps)
    expect(incumbent).toMatchObject({ census: UNVERIFIABLE, readiness: null })
    // The recount before the stop must refuse too, never read as zero.
    await expect(incumbent.recount()).resolves.toEqual(UNVERIFIABLE)
    expect(deps.listen).not.toHaveBeenCalled()
  })

  it('keeps the readiness but never reads zero when the census fails', async () => {
    const { deps, close } = dependencies({
      census: vi.fn(async () => {
        throw new Error('socket closed')
      })
    })
    await expect(readWslOCCdIncumbent({ context: context(), slot }, deps)).resolves.toMatchObject({
      census: UNVERIFIABLE,
      readiness: READINESS
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('touches nothing when no version is active', async () => {
    const { deps } = dependencies()
    await expect(
      readWslOCCdIncumbent({ context: context(null), slot }, deps)
    ).resolves.toMatchObject({ census: UNVERIFIABLE, readiness: null })
    expect(deps.wake).not.toHaveBeenCalled()
  })
})

describe('the incumbent terminal count across restarts', () => {
  it('authenticates with the enrolled pairing, so restarts do not grow the device registry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'occ-incumbent-registry-'))
    try {
      const registry = new DeviceRegistry(dir)
      const enrolled = registry.getOrCreatePendingDevice('CLI', 'runtime')
      registry.updateLastSeen(enrolled.deviceId)
      const paired = parsePairingCode(
        encodePairingOffer({
          v: 2,
          endpoint: 'ws://127.0.0.1:41000',
          deviceToken: enrolled.token,
          publicKeyB64: KEY,
          pairedDeviceId: enrolled.deviceId
        })
      )
      for (let start = 0; start < 3; start += 1) {
        // Each occd start publishes whatever pending device its registry holds.
        const pending = registry.getOrCreatePendingDevice('CLI', 'runtime')
        const readiness: ServeReadiness = {
          ...READINESS,
          pairing: {
            available: true,
            url: encodePairingOffer({
              v: 2,
              endpoint: 'ws://127.0.0.1:6791',
              deviceToken: pending.token,
              publicKeyB64: KEY
            }),
            endpoint: 'ws://127.0.0.1:6791',
            deviceId: pending.deviceId,
            webClientUrl: null,
            scope: 'runtime',
            qr: null
          }
        }
        const { deps } = dependencies({
          probe: vi.fn(async () => readiness),
          // The host marks whichever device authenticated as seen.
          census: vi.fn(async (connection) => {
            const token = pairedRuntimeConnectionToken(connection)
            const device = registry.listDevices().find((entry) => entry.token === token)
            if (device) {
              registry.updateLastSeen(device.deviceId)
            }
            return LIVE
          })
        })
        await readWslOCCdIncumbent({ context: context(), slot, paired }, deps)
      }
      expect(registry.listDevices()).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
