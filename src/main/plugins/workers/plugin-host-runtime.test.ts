import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPluginWorkerRuntime, type PluginWorkerOCCApi } from './plugin-host-runtime'

const init = (overrides: { pluginRoot?: string; mainEntry?: string } = {}) => ({
  occ: 1,
  kind: 'evt',
  event: 'init',
  payload: {
    pluginId: 'samples.demo',
    pluginRoot: '/plugin',
    mainEntry: 'worker.js',
    grantedCapabilities: [],
    ...overrides
  }
})

describe('plugin worker shutdown', () => {
  it('normalizes either manifest separator before importing the worker', async () => {
    const importModule = vi.fn(async () => ({ default: vi.fn() }))
    const runtime = createPluginWorkerRuntime({ send: vi.fn(), importModule })

    await runtime.handleMessage(
      init({ pluginRoot: join('plugin-root'), mainEntry: 'nested\\worker.js' })
    )

    expect(importModule).toHaveBeenCalledWith(
      pathToFileURL(join('plugin-root', 'nested', 'worker.js')).href
    )
  })

  it('awaits an optional deactivate export before exiting', async () => {
    let finishDeactivate!: () => void
    const deactivate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDeactivate = resolve
        })
    )
    const send = vi.fn()
    const exit = vi.fn()
    const runtime = createPluginWorkerRuntime({
      send,
      exit,
      importModule: async () => ({ default: vi.fn(), deactivate })
    })
    await runtime.handleMessage(init())

    const shutdown = runtime.handleMessage({ occ: 1, kind: 'evt', event: 'shutdown' })
    await Promise.resolve()
    expect(deactivate).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()
    finishDeactivate()
    await shutdown

    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits immediately when the plugin has no deactivate export', async () => {
    const exit = vi.fn()
    const runtime = createPluginWorkerRuntime({
      send: vi.fn(),
      exit,
      importModule: async () => ({ default: vi.fn() })
    })
    await runtime.handleMessage(init())

    await runtime.handleMessage({ occ: 1, kind: 'evt', event: 'shutdown' })

    expect(exit).toHaveBeenCalledWith(0)
  })
})

describe('worker occ API parity with frames', () => {
  async function activateWith(activate: (occ: PluginWorkerOCCApi) => void) {
    const send = vi.fn()
    const runtime = createPluginWorkerRuntime({
      send,
      exit: vi.fn(),
      importModule: async () => ({ default: activate })
    })
    await runtime.handleMessage(init())
    return { send, runtime }
  }

  it('exposes api and a synchronous has() for worker methods', async () => {
    let occ!: PluginWorkerOCCApi
    await activateWith((api) => (occ = api))
    expect(occ.api).toEqual({ major: 1, minor: 0 })
    expect(occ.host.has('storage.get')).toBe(true)
    expect(occ.host.has('editor.applyEdit')).toBe(false)
    expect(Object.isFrozen(occ)).toBe(true)
  })

  it('maps host errors to code, retryable and retryAfterMs, unknown codes to action_failed', async () => {
    let occ!: PluginWorkerOCCApi
    const { send, runtime } = await activateWith((api) => (occ = api))
    const limited = occ.host.call('storage.keys')
    const legacy = occ.host.call('storage.keys')
    const [first, second] = send.mock.calls
      .map(([message]) => message)
      .filter((message) => message.kind === 'req')
    await runtime.handleMessage({
      occ: 1,
      kind: 'res',
      id: first.id,
      error: { code: 'rate_limited', message: 'slow down', retryable: true, retryAfterMs: 500 }
    })
    await runtime.handleMessage({
      occ: 1,
      kind: 'res',
      id: second.id,
      error: { code: 'brand_new_code', message: 'newer host', retryable: false }
    })
    await expect(limited).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'slow down',
      retryable: true,
      retryAfterMs: 500
    })
    await expect(legacy).rejects.toMatchObject({ code: 'action_failed', retryable: false })
  })

  it('cancels a host call when its signal aborts', async () => {
    let occ!: PluginWorkerOCCApi
    const { send } = await activateWith((api) => (occ = api))
    const controller = new AbortController()
    const call = occ.host.call('storage.keys', {}, { signal: controller.signal })
    controller.abort()
    await expect(call).rejects.toMatchObject({ code: 'cancelled' })
    expect(send).toHaveBeenLastCalledWith({ occ: 1, kind: 'cancel', id: 0 })
  })

  it('hands command handlers a signal the host aborts, and disposes registrations', async () => {
    const seen: { signal?: AbortSignal } = {}
    let finish!: () => void
    const { send, runtime } = await activateWith((occ) => {
      occ.commands.register('run', (_args, context) => {
        seen.signal = context.signal
        return new Promise<void>((resolve) => (finish = resolve))
      })
      occ.events.on('workspace.created', vi.fn()).dispose()
    })
    expect(send).toHaveBeenLastCalledWith({
      occ: 1,
      kind: 'evt',
      event: 'ready',
      payload: { commands: ['run'] }
    })
    const running = runtime.handleMessage({
      occ: 1,
      kind: 'req',
      id: 9,
      method: 'command.invoke',
      params: { commandId: 'run' }
    })
    await runtime.handleMessage({ occ: 1, kind: 'cancel', id: 9 })
    expect(seen.signal?.aborted).toBe(true)
    finish()
    await running
    expect(send).toHaveBeenLastCalledWith({ occ: 1, kind: 'res', id: 9, result: undefined })
  })

  it('gives format 1 handlers worktreeId alongside workspaceId', async () => {
    const legacy = vi.fn()
    const current = vi.fn()
    const { runtime } = await activateWith((occ) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: format 1 workers pass the old event name the runtime aliases.
      occ.events.on('worktree.created' as 'workspace.created', legacy)
      occ.events.on('workspace.created', current)
    })
    await runtime.handleMessage({
      occ: 1,
      kind: 'req',
      id: 3,
      method: 'event.deliver',
      params: { event: 'workspace.created', payload: { workspaceId: 'w1' } }
    })
    expect(legacy).toHaveBeenCalledWith({ workspaceId: 'w1', worktreeId: 'w1' })
    expect(current).toHaveBeenCalledWith({ workspaceId: 'w1' })
  })
})
