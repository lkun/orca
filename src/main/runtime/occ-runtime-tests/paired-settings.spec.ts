import { describe, expect, it, vi } from 'vitest'
import './runtime-test-module-registration.spec'
import { OCCRuntimeService } from '../occ-runtime'
import {
  applyAgentStatusHooksEnabledMock,
  reconcileClaudeAgentViewMock
} from '../occ-runtime-test-mocks/setup.spec'
import { deferred, store } from './occ-runtime-test-fixtures.spec'
import { RuntimeClientSettingsController } from '../client/settings/runtime-client-settings'

describe('OCCRuntimeService', () => {
  it.each([true, false])(
    'awaits navigation-only updates from paired clients (%s)',
    async (enabled) => {
      let settings = { ...store.getSettings(), claudeSubagentNavigationEnabled: !enabled }
      const controller = new RuntimeClientSettingsController({
        getSettings: () => settings,
        updateSettings: (updates) => {
          settings = { ...settings, ...updates }
        }
      })
      const gate = deferred<void>()
      reconcileClaudeAgentViewMock.mockImplementationOnce(() => gate.promise)
      const complete = vi.fn()
      const pending = controller.update({ claudeSubagentNavigationEnabled: enabled }).then(complete)
      await vi.waitFor(() =>
        expect(reconcileClaudeAgentViewMock).toHaveBeenLastCalledWith(settings)
      )
      expect(complete).not.toHaveBeenCalled()
      gate.resolve()
      await pending
      expect(complete).toHaveBeenCalledOnce()
    }
  )

  it('serializes paired-client hook reconciliation and reads current settings', async () => {
    let settings = {
      ...store.getSettings(),
      agentStatusHooksEnabled: true,
      disabledTuiAgents: ['codex', 'claude']
    }
    const updateSettings = vi.fn((updates: Partial<typeof settings>) => {
      settings = { ...settings, ...updates }
      return settings
    })
    const firstReconciliation = deferred<[]>()
    applyAgentStatusHooksEnabledMock
      .mockImplementationOnce(() => firstReconciliation.promise)
      .mockResolvedValueOnce([])
    const runtime = new OCCRuntimeService({
      ...store,
      getSettings: () => settings,
      updateSettings
    } as never)

    const first = runtime.updateClientSettings({ disabledTuiAgents: ['claude'] })
    await vi.waitFor(() => expect(applyAgentStatusHooksEnabledMock).toHaveBeenCalledOnce())
    const second = runtime.updateClientSettings({ disabledTuiAgents: [] })

    expect(applyAgentStatusHooksEnabledMock).toHaveBeenCalledOnce()
    const firstOptions = applyAgentStatusHooksEnabledMock.mock.calls[0]?.[2]
    expect(firstOptions?.shouldContinue?.('claude')).toBe(true)

    firstReconciliation.resolve([])
    await Promise.all([first, second])

    expect(applyAgentStatusHooksEnabledMock).toHaveBeenCalledTimes(2)
    expect(applyAgentStatusHooksEnabledMock).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({ disabledTuiAgents: [] }),
      expect.objectContaining({ shouldContinue: expect.any(Function) })
    )
  })
})
