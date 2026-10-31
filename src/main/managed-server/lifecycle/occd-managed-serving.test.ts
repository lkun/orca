import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../install/occd-remote-context', () => ({
  resolveOCCdRemoteContext: vi.fn(async () => ({
    connection: {},
    host: {},
    remoteHome: '/home/u',
    userDataDir: '/home/u/.occ'
  }))
}))
vi.mock('./occd-managed-wake', () => ({ wakeStoppedManagedOCCd: vi.fn() }))

import { wakeStoppedManagedOCCd } from './occd-managed-wake'
import {
  ensureManagedOCCdServing,
  MANAGED_OCCD_NOT_ACTIVATED_DETAIL,
  resetManagedOCCdServingForTests,
  setManagedOCCdStartListener,
  type OCCdManagedServingInput
} from './occd-managed-serving'

const listener = { starting: vi.fn(), settled: vi.fn() }
let generation = 1
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the transport generation is read; the remote context is mocked.
const connection = { getConnectGeneration: () => generation } as never

function input(probe: () => Promise<boolean>): OCCdManagedServingInput {
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the id is read.
    environment: { id: 'env-1' } as never,
    target: { id: 'ssh-1', label: 'Box', host: 'box', port: 22, username: 'me' },
    connection,
    remotePort: 6768,
    probe: vi.fn(probe)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetManagedOCCdServingForTests()
  setManagedOCCdStartListener(listener)
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('ensureManagedOCCdServing', () => {
  it('costs one round trip when the server answers', async () => {
    expect(await ensureManagedOCCdServing(input(async () => true))).toEqual({ state: 'serving' })
    expect(wakeStoppedManagedOCCd).not.toHaveBeenCalled()
    expect(listener.starting).not.toHaveBeenCalled()
  })

  it('starts a stopped server from its slot and shows the start on the status line', async () => {
    vi.mocked(wakeStoppedManagedOCCd).mockImplementation(async (_slot, onStarting) => {
      onStarting?.()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only health is read.
      return { outcome: 'started', readiness: { health: { previousIdleStop: null } } as never }
    })

    expect(await ensureManagedOCCdServing(input(async () => false))).toEqual({
      state: 'started',
      boundPort: null
    })
    expect(vi.mocked(wakeStoppedManagedOCCd).mock.calls[0]?.[0]).toMatchObject({ port: 6768 })
    expect(listener.starting).toHaveBeenCalledOnce()
    expect(listener.settled).toHaveBeenCalledWith(expect.anything(), 'env-1', {
      state: 'started',
      boundPort: null
    })
  })

  it('stays unverifiable with the reason when the start fails, never a terminal verdict', async () => {
    vi.mocked(wakeStoppedManagedOCCd).mockImplementation(async (_slot, onStarting) => {
      onStarting?.()
      throw new Error('occd did not become ready.\nLast lines of occd.log:\nboom')
    })

    const serving = await ensureManagedOCCdServing(input(async () => false))
    expect(serving).toEqual({
      state: 'unverifiable',
      detail: 'occd did not become ready.\nLast lines of occd.log:\nboom'
    })
    expect(listener.settled).toHaveBeenCalledWith(expect.anything(), 'env-1', serving)
  })

  it('leaves a live process that did not answer alone', async () => {
    vi.mocked(wakeStoppedManagedOCCd).mockResolvedValue({ outcome: 'serving' })
    const serving = await ensureManagedOCCdServing(input(async () => false))
    expect(serving).toMatchObject({ state: 'unverifiable' })
    expect(listener.starting).not.toHaveBeenCalled()
  })

  it('accepts a live process once a fresh probe answers after the host check', async () => {
    vi.mocked(wakeStoppedManagedOCCd).mockResolvedValue({ outcome: 'serving' })
    const probe = vi.fn(async () => true).mockResolvedValueOnce(false)
    expect(await ensureManagedOCCdServing(input(probe))).toEqual({ state: 'serving' })
    expect(probe).toHaveBeenCalledTimes(2)
    expect(listener.starting).not.toHaveBeenCalled()
  })

  it('keeps a failed fresh probe unverifiable without starting another process', async () => {
    vi.mocked(wakeStoppedManagedOCCd).mockResolvedValue({ outcome: 'serving' })
    const probe = vi
      .fn(async () => false)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('SSH link was replaced'))
    expect(await ensureManagedOCCdServing(input(probe))).toEqual({
      state: 'unverifiable',
      detail: 'SSH link was replaced'
    })
    expect(listener.starting).not.toHaveBeenCalled()
  })

  it.each(['fenced', 'unverifiable', 'not-activated'] as const)(
    'does not start a server whose host says %s',
    async (outcome) => {
      vi.mocked(wakeStoppedManagedOCCd).mockResolvedValue({ outcome })
      const serving = await ensureManagedOCCdServing(input(async () => false))
      expect(serving.state).toBe('unverifiable')
      expect(listener.starting).not.toHaveBeenCalled()
    }
  )

  it('shares one check between a fresh tunnel and the connect right after it', async () => {
    let now = 0
    const probe = vi.fn(async () => true)
    const first = input(probe)
    await Promise.all([
      ensureManagedOCCdServing(first, () => now),
      ensureManagedOCCdServing(first, () => now)
    ])
    now = 4_000
    await ensureManagedOCCdServing(first, () => now)
    expect(probe).toHaveBeenCalledOnce()
    now = 6_000
    await ensureManagedOCCdServing(first, () => now)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('runs its own start on a reconnected transport instead of inheriting a dropped one', async () => {
    let dropFirst!: (error: Error) => void
    vi.mocked(wakeStoppedManagedOCCd)
      .mockImplementationOnce(
        (_slot, onStarting) =>
          new Promise((_resolve, reject) => {
            onStarting?.()
            dropFirst = reject
          })
      )
      .mockImplementationOnce(async () => ({
        outcome: 'started',
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only health and boundEndpoint are read.
        readiness: { health: { previousIdleStop: null } } as never
      }))
    const onDropped = ensureManagedOCCdServing(input(async () => false))
    await vi.waitFor(() => expect(wakeStoppedManagedOCCd).toHaveBeenCalledOnce())

    generation += 1
    const onReconnected = ensureManagedOCCdServing(input(async () => false))
    dropFirst(new Error('SSH connection lost'))

    expect(await onReconnected).toEqual({ state: 'started', boundPort: null })
    expect(await onDropped).toMatchObject({ state: 'unverifiable' })
    expect(wakeStoppedManagedOCCd).toHaveBeenCalledTimes(2)
  })

  it('never answers a new SSH transport from an earlier verdict, as after a reboot', async () => {
    const probe = vi.fn(async () => true)
    await ensureManagedOCCdServing(input(probe), () => 0)
    generation += 1
    await ensureManagedOCCdServing(input(probe), () => 1)
    expect(probe).toHaveBeenCalledTimes(2)
    await ensureManagedOCCdServing({ ...input(probe), remotePort: 40_001 }, () => 2)
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('skips the probe after an idle pause while the control socket keeps answering', async () => {
    let now = 0
    const probe = vi.fn(async () => true)
    const answeredAt = vi.fn((): number | null => null)
    const live = { ...input(probe), answeredAt }
    await ensureManagedOCCdServing(live, () => now)
    expect(probe).toHaveBeenCalledOnce()

    now = 6_000
    answeredAt.mockReturnValue(4_000)
    expect(await ensureManagedOCCdServing(live, () => now)).toEqual({ state: 'serving' })
    expect(answeredAt).toHaveBeenCalledWith('env-1')
    expect(probe).toHaveBeenCalledOnce()
  })

  it('shares one probe between concurrent calls once the last answer is stale', async () => {
    let answer!: (value: boolean) => void
    const probe = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)))
    const stale = { ...input(probe), answeredAt: () => 0 }
    const calls = [1, 2, 3].map(() => ensureManagedOCCdServing(stale, () => 60_000))
    answer(true)
    expect(await Promise.all(calls)).toEqual([
      { state: 'serving' },
      { state: 'serving' },
      { state: 'serving' }
    ])
    expect(probe).toHaveBeenCalledOnce()
  })

  it('still detects a stopped server once its control socket closed', async () => {
    vi.mocked(wakeStoppedManagedOCCd).mockResolvedValue({ outcome: 'not-activated' })
    const answeredAt = vi.fn((): number | null => 0)
    const probe = vi.fn(async () => true)
    const watched = { ...input(probe), answeredAt }
    expect(await ensureManagedOCCdServing(watched, () => 0)).toEqual({ state: 'serving' })
    expect(probe).not.toHaveBeenCalled()

    answeredAt.mockReturnValue(null)
    probe.mockResolvedValue(false)
    expect(await ensureManagedOCCdServing(watched, () => 1_000)).toEqual({
      state: 'unverifiable',
      detail: MANAGED_OCCD_NOT_ACTIVATED_DETAIL
    })
    expect(probe).toHaveBeenCalledOnce()
  })

  it('does not take an answer from a wall clock that moved backwards as proof', async () => {
    const probe = vi.fn(async () => true)
    await ensureManagedOCCdServing({ ...input(probe), answeredAt: () => 50_000 }, () => 10_000)
    expect(probe).toHaveBeenCalledOnce()
  })
})
