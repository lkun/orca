import { afterEach, describe, expect, it } from 'vitest'
import { agentStatusChangedPayloadSchema } from '../../events/plugin-events'
import { terminalSendHookPayloadSchema } from '../../events/plugin-hook-payloads'
import { atom, read, set } from '../runtime/declarative-atoms'
import { h } from '../runtime/declarative-elements'
import { host as panelHost, plugin } from '../runtime/occ-module'
import { mockHost, mount, mountWorker, type TestPanel } from './occ-testing'

type OCC = {
  log(message: string): void
  host: { call(method: string, params?: unknown): Promise<unknown> }
  events: { on(event: string, handler: (payload: unknown) => unknown): unknown }
  commands: { register(id: string, handler: (args: unknown) => unknown): unknown }
  panels: {
    handle(
      name: string,
      handler: (input: unknown, context: { panel: { contributionId: string } }) => unknown
    ): unknown
    post(event: string, payload?: unknown): void
  }
  storage: { set(key: string, value: unknown): Promise<void> }
}

type HookedOCC = OCC & {
  hooks: {
    on(hook: string, handler: (event: unknown, next: (e: unknown) => unknown) => unknown): unknown
  }
}

let panel: TestPanel | null = null
afterEach(async () => {
  await panel?.unmount()
  panel = null
})

const status = (state: string) => ({
  workspaceId: 'ws1',
  paneKey: 'tab1:pane1',
  state,
  receivedAt: 1
})

function boardWorker() {
  const seen: string[] = []
  let stopped = false
  return {
    seen,
    stopped: () => stopped,
    module: {
      default(occ: OCC) {
        occ.events.on('agent.status.changed', async (payload) => {
          const { paneKey, state } = agentStatusChangedPayloadSchema.parse(payload)
          seen.push(`${paneKey}:${state}`)
          if (state === 'blocked') {
            await occ.host.call('notifications.show', { title: `${paneKey} needs you` })
          }
        })
        occ.commands.register('board.count', () => seen.length)
        occ.panels.handle('board.list', async (input, { panel }) => {
          await occ.storage.set('lastAsk', panel.contributionId)
          occ.panels.post('board.asked', { input })
          return seen
        })
        occ.log('activated')
      },
      deactivate() {
        stopped = true
      }
    }
  }
}

describe('mountWorker', () => {
  it('activates, delivers checked events, runs commands and deactivates', async () => {
    const worker = boardWorker()
    const host = mockHost({ capabilities: ['agent:read', 'notifications:show', 'storage:own'] })
    const mounted = await mountWorker(worker.module, {
      host,
      events: ['agent.status.changed'],
      commands: ['board.count']
    })
    expect(mounted.logs).toEqual(['activated'])

    await mounted.emit('agent.status.changed', status('working'))
    await mounted.emit('agent.status.changed', status('blocked'))
    expect(worker.seen).toEqual(['tab1:pane1:working', 'tab1:pane1:blocked'])
    expect(host.callsOf('notifications.show')).toEqual([{ title: 'tab1:pane1 needs you' }])
    expect(await mounted.command('board.count')).toBe(2)

    await expect(mounted.emit('agent.status.changed', { paneKey: 1 })).rejects.toThrow(
      /not one OCC sends/
    )
    await expect(mounted.emit('workspace.created', {})).rejects.toThrow(/not in contributes.events/)
    await expect(mounted.command('board.missing')).rejects.toThrow(/registered no/)
    expect(await mounted.request('board.list', { all: true }, { panel: 'board' })).toEqual(
      worker.seen
    )
    expect(mounted.posts).toEqual([{ event: 'board.asked', payload: { input: { all: true } } }])
    expect(host.data().storage).toEqual({ lastAsk: 'board' })
    await expect(mounted.request('board.missing')).rejects.toMatchObject({ code: 'unknown_method' })

    await mounted.deactivate()
    expect(worker.stopped()).toBe(true)
  })

  it('records calls OCC would refuse even when the worker catches them', async () => {
    const host = mockHost({ capabilities: [] })
    const mounted = await mountWorker(
      {
        default: async (occ: OCC) => {
          await occ.host.call('notifications.show', { title: 'hi' }).catch(() => undefined)
          await occ.host
            .call('shell.openExternal', { url: 'https://x.dev' })
            .catch(() => undefined)
        }
      },
      { host, events: [], commands: [] }
    )
    expect(mounted.refusals.map(({ method, code }) => `${method} ${code}`)).toEqual([
      'notifications.show capability_denied',
      'shell.openExternal not_permitted'
    ])
  })

  it('refuses a module with no default-exported activate, and a command not in the manifest', async () => {
    await expect(mountWorker({}, { events: [], commands: [] })).rejects.toThrow(/default-exported/)
    await expect(
      mountWorker({ activate: () => undefined }, { events: [], commands: [] })
    ).rejects.toThrow(/exports activate by name/)
    await expect(
      mountWorker(
        { default: (occ: OCC) => occ.commands.register('other', () => 1) },
        { events: [], commands: ['board.count'] }
      )
    ).rejects.toThrow(/registered undeclared command other/)
  })

  it('fires hooks as OCC would and returns what the chain decided', async () => {
    const mounted = await mountWorker(
      {
        default(occ: HookedOCC) {
          occ.hooks.on('terminal.send', (event, next) => {
            const { text } = terminalSendHookPayloadSchema.parse(event)
            if (text.includes('rm -rf')) {
              return { deny: 'blocked' }
            }
            if (text === 'boom') {
              throw new Error('hook failed')
            }
            return next({ ...terminalSendHookPayloadSchema.parse(event), text: text.trim() })
          })
        }
      },
      { events: [], commands: [], hooks: ['terminal.send'] }
    )
    const send = (text: string) => ({ terminalId: 't', text, enter: true, inputKind: 'driving' })
    await expect(mounted.hooks.fire('terminal.send', send(' ls '))).resolves.toEqual({
      kind: 'continue',
      event: send('ls')
    })
    await expect(mounted.hooks.fire('terminal.send', send('rm -rf /'))).resolves.toEqual({
      kind: 'deny',
      reason: 'blocked'
    })
    await expect(mounted.hooks.fire('terminal.send', send('boom'))).resolves.toEqual({
      kind: 'continue',
      event: send('boom')
    })
    expect(mounted.logs.at(-1)).toMatch(/hook terminal\.send skipped after \d+ms: hook failed/)
    await expect(mounted.hooks.fire('terminal.send', { text: 1 })).rejects.toThrow(
      /not one OCC sends/
    )
    await expect(mounted.hooks.fire('workspace.create.after', {})).rejects.toThrow(
      /not in contributes.hooks/
    )
  })
})

describe('panel refusals', () => {
  it('lists host calls OCC refuses even when the panel catches them', async () => {
    const host = mockHost({ capabilities: [] })
    panel = await mount(
      () =>
        h(
          'Button',
          {
            onPress: () => panelHost.call('workspace.readContext').catch(() => undefined)
          },
          'Load'
        ),
      { host }
    )
    await panel.press({ role: 'button' })
    expect(panel.refusals).toEqual([
      {
        method: 'workspace.readContext',
        code: 'capability_denied',
        message: 'workspace.readContext needs the workspace:read capability'
      }
    ])
    expect(panel.errors).toEqual([])
  })
})

describe('a panel and its worker on one host', () => {
  it("routes the panel's plugin.request to the mounted worker, unless `requests` stubs it", async () => {
    const host = mockHost({ capabilities: [], requests: { stubbed: 'from the stub' } })
    const worker = await mountWorker(
      {
        default: (occ: OCC) => {
          occ.panels.handle('stats', (input) => ({ asked: input }))
          occ.panels.handle('stubbed', () => 'from the worker')
        }
      },
      { host, events: [], commands: [] }
    )
    const answers = atom<unknown[]>([])
    panel = await mount(
      {
        setup: () => {
          void Promise.all([
            plugin.request('stats', { n: 1 }),
            plugin.request('stubbed'),
            plugin.request('missing').catch((error: { code?: string }) => error.code)
          ]).then((values) => set(answers, values))
        },
        default: () => h('Text', null, JSON.stringify(read(answers)))
      },
      { host }
    )
    expect(panel.find({ role: 'text' })?.text).toBe(
      JSON.stringify([{ asked: { n: 1 } }, 'from the stub', 'unknown_method'])
    )
    await worker.deactivate()
  })
})
