import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { getDefaultSettings } from '../../shared/constants'

const { prepareHooks, resolveHome, listHomes } = vi.hoisted(() => ({
  prepareHooks: vi.fn(
    async (_home: string, _isHooksEnabled: () => boolean, _launchesCodex: boolean) => {}
  ),
  resolveHome: vi.fn((candidate: string | undefined): string | null =>
    candidate === '/home/u/.local/share/occ/codex-accounts/a1/home' ? candidate : null
  ),
  listHomes: vi.fn(() => ['/home/u/.local/share/occ/codex-accounts/a1/home'])
}))

const wslHost = vi.hoisted(() => vi.fn(() => false))
vi.mock('../ipc/wsl-guest-windows-drive-path', () => ({ isWslHostOCCdProcess: wslHost }))
vi.mock('../codex/codex-account-home-hook', () => ({
  reconcileCodexAccountHomeHook: prepareHooks
}))
vi.mock('../codex/codex-state-db-backfill-recovery', () => ({
  stopCodexStateDbBackfillRecoveries: vi.fn(async () => {})
}))
vi.mock('../codex-accounts/guest-codex-account-homes', () => ({
  resolveGuestCodexAccountHome: resolveHome,
  listGuestCodexAccountHomes: listHomes
}))

import { occdCodexAccountHomes } from './occd-codex-account-homes'

const noCleanup = (): void => {}
const ACCOUNT_HOME = '/home/u/.local/share/occ/codex-accounts/a1/home'

function settings(overrides: Partial<GlobalSettings>): GlobalSettings {
  return {
    ...getDefaultSettings('/home/u'),
    agentStatusHooksEnabled: true,
    ...overrides
  }
}

describe('occdCodexAccountHomes', () => {
  beforeEach(() => {
    prepareHooks.mockClear()
  })

  it('on a WSL host with hooks off, leaves the bridge-shared entry alone', async () => {
    wslHost.mockReturnValue(true)
    const homes = occdCodexAccountHomes(
      () => settings({ agentStatusHooksEnabled: false }),
      noCleanup
    )
    await expect(homes.selectLaunchHome(undefined, { CODEX_HOME: ACCOUNT_HOME })).resolves.toBe(
      ACCOUNT_HOME
    )
    expect(prepareHooks).not.toHaveBeenCalled()
    wslHost.mockReturnValue(false)
  })

  it('puts the hook into a client-sent account home and launches on it', async () => {
    const homes = occdCodexAccountHomes(() => settings({}), noCleanup)
    await expect(
      homes.selectLaunchHome(
        { runtime: 'host' },
        { CODEX_HOME: ACCOUNT_HOME },
        { launchesCodex: true }
      )
    ).resolves.toBe(ACCOUNT_HOME)
    expect(prepareHooks).toHaveBeenCalledWith(ACCOUNT_HOME, expect.any(Function), true)
  })

  it('reads the hook switch live, so turning hooks off takes the entry out', async () => {
    let current = settings({})
    const homes = occdCodexAccountHomes(() => current, noCleanup)
    await homes.selectLaunchHome(undefined, { CODEX_HOME: ACCOUNT_HOME })
    const isEnabled = prepareHooks.mock.calls[0]?.[1]
    expect(isEnabled?.()).toBe(true)
    current = settings({ agentStatusHooksEnabled: false })
    expect(isEnabled?.()).toBe(false)
    expect(prepareHooks.mock.calls[0]?.[2]).toBe(false)
  })

  it('leaves a launch without an OCC account home alone', async () => {
    const homes = occdCodexAccountHomes(() => settings({}), noCleanup)
    await expect(
      homes.selectLaunchHome(undefined, { CODEX_HOME: '/home/u/my-codex' })
    ).resolves.toBe(null)
    await expect(homes.selectLaunchHome(undefined, {})).resolves.toBe(null)
    await expect(homes.selectLaunchHome()).resolves.toBe(null)
    expect(prepareHooks).not.toHaveBeenCalled()
  })

  it('lists the account homes for session discovery', () => {
    expect(occdCodexAccountHomes(() => settings({}), noCleanup).listSessionHomes()).toEqual([
      ACCOUNT_HOME
    ])
  })
})
