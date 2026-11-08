import { afterEach, describe, expect, it, vi } from 'vitest'

const initDaemonPtyProvider = vi.hoisted(() => vi.fn())
vi.mock('../daemon/providers/lifecycle/daemon-provider-init', () => ({ initDaemonPtyProvider }))

import { startOCCdDaemon } from './occd-daemon-supervision'
import { OCCdTerminalsNotDurableError } from './occd-serve-supervision'
import { resolveOCCdExitCode } from './occd-exit-code'
import {
  OCC_SERVE_SUPERVISED_ENV,
  OCCD_EXIT_TERMINALS_NOT_DURABLE
} from '../../shared/serve-supervised-terminal-durability'

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env[OCC_SERVE_SUPERVISED_ENV]
})

describe('startOCCdDaemon', () => {
  it('refuses to serve a supervised host whose terminals would die with it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    initDaemonPtyProvider.mockRejectedValue(new Error('daemon health check rejected'))

    process.env[OCC_SERVE_SUPERVISED_ENV] = '1'
    const supervised = startOCCdDaemon('linux')
    await expect(supervised).rejects.toBeInstanceOf(OCCdTerminalsNotDurableError)
    const error = await supervised.catch((caught: unknown) => caught)
    expect(resolveOCCdExitCode(error)).toBe(OCCD_EXIT_TERMINALS_NOT_DURABLE)
    expect(String(error)).toContain('daemon health check rejected')
    expect(process.env[OCC_SERVE_SUPERVISED_ENV]).toBeUndefined()

    await expect(startOCCdDaemon('linux')).resolves.toMatchObject({
      state: 'unavailable'
    })
  })
})
