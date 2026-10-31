import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalUpdateAdmission } from '../runtime/terminal/stop/terminal-update-admission'
import type { installOCCdShutdownSignals } from './occd-lifecycle'
import type { prepareOCCdManagedStop } from './occd-managed-stop-admission'
import type * as Holder from './occd-stop-terminal-admission'

// Reset process-wide stop state between tests.
let stops: {
  installOCCdShutdownSignals: typeof installOCCdShutdownSignals
  prepareOCCdManagedStop: typeof prepareOCCdManagedStop
  holder: typeof Holder
}
beforeEach(async () => {
  vi.resetModules()
  stops = {
    installOCCdShutdownSignals: (await import('./occd-lifecycle')).installOCCdShutdownSignals,
    prepareOCCdManagedStop: (await import('./occd-managed-stop-admission'))
      .prepareOCCdManagedStop,
    holder: await import('./occd-stop-terminal-admission')
  }
})

let now = 1_000
let admission = new TerminalUpdateAdmission(
  async () => [],
  () => now
)

function freshAdmission(): TerminalUpdateAdmission {
  now = 1_000
  admission = new TerminalUpdateAdmission(
    async () => [],
    () => now
  )
  stops.holder.bindOCCdStopTerminalAdmission(admission)
  return admission
}

function expectHeldPastEveryReopen(): void {
  admission.close(0)
  expect(admission.isClosed()).toBe(true)
  admission.close(60_000)
  now += 61_000
  expect(admission.isClosed()).toBe(true)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('occd stop terminal admission', () => {
  it('closes admission when a managed stop begins, before anything else it prepares', async () => {
    freshAdmission()
    let closedFirst = false
    await stops.prepareOCCdManagedStop(
      {
        schemaVersion: 1,
        transactionId: 't',
        version: '1.0.0',
        runtimeId: 'r',
        instance: { pid: 1, startedAtMs: null, nonce: 'n', lockPath: '/tmp/occd.lock' }
      },
      async () => ({ retirement: 'retired', liveSessions: 0, reason: null }),
      () => {
        closedFirst = admission.isClosed()
      }
    )

    expect(closedFirst).toBe(true)
    expectHeldPastEveryReopen()
  })

  it('closes admission when any shutdown begins, before the runtime stops', () => {
    vi.useFakeTimers()
    vi.spyOn(process, 'on').mockImplementation(() => process)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    freshAdmission()
    let closedAtStop = false
    const shutdown = stops.installOCCdShutdownSignals(async () => {
      closedAtStop = admission.isClosed()
      return new Promise<void>(() => {})
    })

    expect(shutdown('idle')).toBe(true)
    expect(closedAtStop).toBe(true)
    expectHeldPastEveryReopen()
  })

  it('holds admission for a stop that began before the runtime bound it', () => {
    stops.holder.holdOCCdTerminalAdmissionUntilExit()
    freshAdmission()
    expectHeldPastEveryReopen()
  })
})
