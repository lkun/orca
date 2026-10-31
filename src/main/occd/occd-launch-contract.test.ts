import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseArgs } from './occd-command-arguments'
import { OCCD_EXIT_CONFIGURATION } from './occd-configuration-exit'
import { OCCD_EXIT_FAILED, resolveOCCdExitCode } from './occd-exit-code'
import { startOCCdWithLifecycle } from './occd-lifecycle'
import {
  beginAgentSessionRuntimeRecord,
  readAgentSessionRuntimeEnds
} from '../runtime/agent-session-runtime-end-record'
import { OCCdBindAddressError } from './occd-bind-address'
import { OCCdInstanceLockError } from './occd-data-root-privacy'
import { ProfileStateAccessError } from '../persistence/profile-state/profile-state-access'
import { OCCdBundledRuntimeError } from './occd-bundled-runtime'

describe('parseArgs', () => {
  it('accepts help alongside valid server flags', () => {
    expect(parseArgs(['--help'])).toEqual({ help: true })
    expect(parseArgs(['-h'])).toEqual({ help: true })
    expect(parseArgs(['--json', '--help', '--port', '0'])).toEqual({
      json: true,
      help: true,
      port: 0
    })
  })

  it('keeps help-looking values as values', () => {
    expect(parseArgs(['--bind', '--help'])).toEqual({ bind: '--help' })
    expect(parseArgs(['--pairing-address', '-h'])).toEqual({ pairingAddress: '-h' })
    expect(parseArgs(['--project-root', '--help'])).toEqual({ projectRoot: '--help' })
    expect(parseArgs(['--bind', '--help', '-h'])).toEqual({ bind: '--help', help: true })
  })

  it('still rejects invalid arguments and incompatible flags with help', () => {
    expect(() => parseArgs(['--help', '--unknown'])).toThrow('Unknown argument: --unknown')
    expect(() => parseArgs(['--help', '--port', 'bad'])).toThrow('--port expects an integer')
    expect(() => parseArgs(['--help', '--bind'])).toThrow('--bind expects a value')
    expect(() => parseArgs(['--help', '--recipe-json'])).toThrow(
      'Recipe JSON output requires --project-root.'
    )
    for (const flag of ['--no-pairing', '--mobile-pairing']) {
      expect(() => parseArgs(['--help', '--grant-desktop-control', flag])).toThrow(
        '--grant-desktop-control applies only to the default runtime pairing offer'
      )
    }
  })

  it('accepts the browser client directory occ serve hands it', () => {
    expect(parseArgs(['--web-client-root', '/app/out/web'])).toEqual({
      webClientRoot: '/app/out/web'
    })
    expect(() => parseArgs(['--web-client-root'])).toThrow('--web-client-root expects a value')
  })

  it('accepts --bind and leaves it unset when absent', () => {
    expect(parseArgs(['--bind', '0.0.0.0'])).toEqual({ bind: '0.0.0.0' })
    expect(parseArgs([])).toEqual({})
    expect(parseArgs(['--port', '6768', '--bind', '10.0.0.5', '--json'])).toEqual({
      port: 6768,
      bind: '10.0.0.5',
      json: true
    })
  })

  it('takes the desktop serve flags occ serve forwards', () => {
    expect(parseArgs(['--recipe-json', '--project-root', '/work/app'])).toEqual({
      recipeJson: true,
      projectRoot: '/work/app'
    })
    expect(parseArgs(['--mobile-pairing'])).toEqual({ mobilePairing: true })
    expect(parseArgs(['--no-pairing'])).toEqual({ noPairing: true })
    expect(() => parseArgs(['--recipe-json'])).toThrow(
      'Recipe JSON output requires --project-root.'
    )
    expect(() => parseArgs(['--project-root'])).toThrow('--project-root expects a value')
  })

  it('rejects contradictory pairing flags with the desktop serve message', () => {
    expect(() => parseArgs(['--no-pairing', '--mobile-pairing'])).toThrow(
      'Use either --mobile-pairing or --no-pairing, not both.'
    )
    for (const flag of ['--no-pairing', '--mobile-pairing']) {
      expect(() => parseArgs(['--recipe-json', '--project-root', '/work/app', flag])).toThrow(
        `Recipe JSON output requires runtime pairing; remove ${flag}.`
      )
    }
  })

  it('rejects --bind with no value rather than silently binding the default', () => {
    expect(() => parseArgs(['--bind'])).toThrow('--bind expects a value')
    expect(() => parseArgs(['--bind', '--json'])).not.toThrow()
  })
})

describe('resolveOCCdExitCode', () => {
  it('separates a configuration fault from a generic failure', () => {
    expect(
      resolveOCCdExitCode(new OCCdInstanceLockError('occd_instance_lock_held', 'held'))
    ).toBe(OCCD_EXIT_CONFIGURATION)
    expect(resolveOCCdExitCode(new OCCdBindAddressError('bad'))).toBe(OCCD_EXIT_CONFIGURATION)
    expect(resolveOCCdExitCode(new ProfileStateAccessError('recovery interrupted'))).toBe(
      OCCD_EXIT_CONFIGURATION
    )
    expect(resolveOCCdExitCode(new Error('port in use'))).toBe(OCCD_EXIT_FAILED)
    expect(resolveOCCdExitCode(new OCCdBundledRuntimeError('partial installation'))).toBe(
      OCCD_EXIT_CONFIGURATION
    )
    expect(OCCD_EXIT_CONFIGURATION).not.toBe(OCCD_EXIT_FAILED)
  })
})

describe('occd lifecycle cleanup', () => {
  it('uninstalls registered runtime resources when startup fails', async () => {
    const cleanupRuntime = vi.fn(async () => {})
    const cleanupHost = vi.fn(async () => {})

    await expect(
      startOCCdWithLifecycle(async (registerCleanup) => {
        registerCleanup(cleanupRuntime)
        await Promise.resolve()
        throw new Error('startup failed')
      }, cleanupHost)
    ).rejects.toThrow('startup failed')

    expect(cleanupRuntime).toHaveBeenCalledOnce()
    expect(cleanupHost).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('preserves the startup error when rollback also fails', async () => {
    const startupError = new Error('bind failed')
    const cleanupError = new Error('daemon stop failed')
    const cleanupRuntime = vi.fn(async () => {})
    const cleanupHost = vi.fn(async () => {
      throw cleanupError
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(
        startOCCdWithLifecycle(async (registerCleanup) => {
          registerCleanup(cleanupRuntime)
          throw startupError
        }, cleanupHost)
      ).rejects.toBe(startupError)
      expect(report).toHaveBeenCalledWith('[occd] startup cleanup failed:', cleanupError)
    } finally {
      report.mockRestore()
    }
  })

  it('coalesces concurrent and repeated normal stops', async () => {
    const cleanupRuntime = vi.fn(async () => {})
    const cleanupHost = vi.fn(async () => {})
    const handle = await startOCCdWithLifecycle(async (registerCleanup) => {
      registerCleanup(cleanupRuntime)
      return { readiness: 'ready' }
    }, cleanupHost)

    await Promise.all([handle.stop(), handle.stop()])
    await handle.stop()

    expect(cleanupRuntime).toHaveBeenCalledOnce()
    expect(cleanupHost).toHaveBeenCalledOnce()
  })

  it("records the runtime's end before its stop waits on anything", async () => {
    const directory = await mkdtemp(join(tmpdir(), 'occd-runtime-end-'))
    try {
      beginAgentSessionRuntimeRecord(directory, 'occd-runtime', 1)
      let endSeenByCleanup: string | undefined
      const handle = await startOCCdWithLifecycle(
        async (registerCleanup) => {
          registerCleanup(async () => {
            endSeenByCleanup = readAgentSessionRuntimeEnds(directory)?.get('occd-runtime')
          })
          return {}
        },
        vi.fn(async () => {})
      )

      await handle.stop()

      expect(endSeenByCleanup).toBe('quit')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps the host aware of failed runtime teardown so it cannot release profile admission', async () => {
    const failure = new Error('profile writer still running')
    const cleanupHost = vi.fn(async () => {})
    const handle = await startOCCdWithLifecycle(async (registerCleanup) => {
      registerCleanup(async () => {
        throw failure
      })
      return {}
    }, cleanupHost)
    await expect(handle.stop()).rejects.toBe(failure)
    expect(cleanupHost).toHaveBeenCalledExactlyOnceWith(false)
  })
})
