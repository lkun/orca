import { describe, expect, it, vi } from 'vitest'
import type { OCCdDecommissionResult } from '../../shared/occd-decommission'
import type { OCCdTerminalCensus } from '../../shared/occd-terminal-census'
import {
  stopWslHostServer,
  wslHostRuntimeStopSteps,
  type WslHostRuntimeAccess,
  type WslHostServerStopSteps
} from './wsl-host-server-stop'
import type { WslHostPeerDesktops } from './wsl-host-peer-desktops'

function census(liveSessions: number | null): OCCdTerminalCensus {
  return { liveSessions, startedSinceActivation: liveSessions, daemonProtocolVersion: 1 }
}

const RETIRED: OCCdDecommissionResult = {
  outcome: 'decommissioned',
  version: '1.0.0',
  retirement: 'retired'
}

function steps(overrides: Partial<WslHostServerStopSteps> = {}) {
  const order: string[] = []
  const all: WslHostServerStopSteps = {
    peerDesktops: vi.fn(async (): Promise<WslHostPeerDesktops> => ({ kind: 'none' })),
    endTerminals: vi.fn(async () => {
      order.push('endTerminals')
      return []
    }),
    census: vi.fn(async () => {
      order.push('census')
      return census(0)
    }),
    servingRuntimeId: vi.fn(async () => {
      order.push('servingRuntimeId')
      return 'runtime-a'
    }),
    closeBridge: vi.fn(async () => {
      order.push('closeBridge')
    }),
    decommission: vi.fn(async () => {
      order.push('decommission')
      return RETIRED
    }),
    sleep: vi.fn(async () => {}),
    ...overrides
  }
  return { all, order }
}

describe('stopWslHostServer', () => {
  it('closes terminals, proves none remain, names the serving occd, then retires it', async () => {
    const { all, order } = steps()
    await expect(stopWslHostServer(all)).resolves.toEqual({ stopped: true })
    expect(order).toEqual([
      'endTerminals',
      'census',
      'servingRuntimeId',
      'closeBridge',
      'decommission'
    ])
    expect(all.decommission).toHaveBeenCalledWith(census(0), 'runtime-a')
  })

  it('retries a lingering census 20 times, 250 ms apart, unless a caller sets fewer', async () => {
    const lingering = () => vi.fn(async () => census(1))
    const remove = steps({ census: lingering() })
    await stopWslHostServer(remove.all)
    expect(remove.all.census).toHaveBeenCalledTimes(20)
    expect(remove.all.sleep).toHaveBeenCalledTimes(19)
    expect(remove.all.sleep).toHaveBeenCalledWith(250)

    const single = steps({ census: lingering(), censusAttempts: 1 })
    await stopWslHostServer(single.all)
    expect(single.all.census).toHaveBeenCalledTimes(1)
    expect(single.all.sleep).not.toHaveBeenCalled()
  })

  it('keeps a server another OCC shares: only this desktop lets go, nothing ends', async () => {
    const { all, order } = steps({
      peerDesktops: vi.fn(async (): Promise<WslHostPeerDesktops> => ({
        kind: 'shared',
        names: ['OCC Dev']
      }))
    })
    await expect(stopWslHostServer(all)).resolves.toEqual({
      stopped: true,
      keptForOtherDesktops: ['OCC Dev']
    })
    expect(order).toEqual(['closeBridge'])
  })

  it('refuses the teardown when the server cannot say who else uses it', async () => {
    const { all, order } = steps({
      peerDesktops: vi.fn(async () => {
        throw new Error('runtime_device_required')
      })
    })
    await expect(stopWslHostServer(all)).resolves.toMatchObject({
      stopped: false,
      verdict: 'unverifiable',
      reason: expect.stringContaining('another OCC on this computer')
    })
    expect(order).toEqual(['closeBridge'])
  })

  it("keeps today's teardown, with a warning, for a server that predates the check", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { all, order } = steps({
      peerDesktops: vi.fn(async (): Promise<WslHostPeerDesktops> => ({ kind: 'unsupported' }))
    })
    await expect(stopWslHostServer(all)).resolves.toEqual({ stopped: true })
    expect(order).toContain('decommission')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('predates the shared-host check'))
    warn.mockRestore()
  })

  it('reports a daemon that did not retire', async () => {
    const { all } = steps({
      decommission: vi.fn(async (): Promise<OCCdDecommissionResult> => ({
        ...RETIRED,
        retirement: 'live'
      }))
    })
    await expect(stopWslHostServer(all)).resolves.toEqual({
      stopped: false,
      reason: 'OCC’s server stopped, but its terminal daemon is still running.',
      verdict: 'live'
    })
  })
})

describe('wslHostRuntimeStopSteps', () => {
  it('closes every terminal by handle and keeps going past one that fails', async () => {
    const call = vi.fn(async (_environmentId: string, method: string, params: unknown) => {
      if (method === 'terminal.list') {
        return {
          terminals: [
            { handle: 'term_orphan', worktreeId: 'gone::/home/me/old' },
            { handle: 'term_live', worktreeId: 'app::/home/me/app' }
          ]
        }
      }
      if (method === 'terminal.close' && JSON.stringify(params).includes('term_orphan')) {
        throw new Error('selector_not_found')
      }
      return {}
    })
    const access: WslHostRuntimeAccess = { call, census: async () => census(0) }

    await expect(wslHostRuntimeStopSteps(access, 'wsl:ubuntu').endTerminals()).resolves.toEqual([
      { handle: 'term_orphan', worktreeId: 'gone::/home/me/old', reason: 'selector_not_found' }
    ])
    expect(call).toHaveBeenCalledWith('wsl:ubuntu', 'terminal.close', { terminal: 'term_live' })
    expect(call).not.toHaveBeenCalledWith('wsl:ubuntu', 'terminal.stop', expect.anything())
  })
})
