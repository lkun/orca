import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLUGIN_HOST_TYPINGS_FILE, renderPluginHostTypings } from './plugin-host-typings'
import {
  authorTypingsDiagnostics,
  authorTypingsProgram
} from './plugin-author-typings.test-fixture'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..')

// One contract, declared once and read by the frame, the worker and the components panel.
const PROTOCOL = `
export type Todo = { id: string; title: string; done: boolean }
declare module 'occ' {
  interface PluginRequests {
    'todos.list': { input: { done?: boolean }; output: Todo[] }
    'todos.add': { input: { title: string }; output: Todo }
  }
  interface PluginPanelEvents {
    'todos.changed': { count: number }
  }
}
`

const FRAME_SCRIPT = `
import type { JsonValue } from 'occ/host'
import type { Todo } from '../protocol'

const context = await occ.host.call('workspace.readContext')
const branch: string | undefined = context?.branch
const shown: { delivered: boolean } = await window.occ.host.call('notifications.show', { title: 'Hi' })
occ.on('theme', ({ colorScheme }) => colorScheme satisfies 'light' | 'dark')
occ.on('editor.flush', async () => {})
const doc = await occ.document?.get()
if (doc?.content.kind === 'text') {
  await occ.document?.applyEdit({ baseVersion: doc.version, content: { kind: 'text', text: '' } })
}
await occ.files?.saveAs({ suggestedName: 'a.txt', data: new Uint8Array(1) })
// @ts-expect-error worker-only method
await occ.host.call('terminal.sendText', { terminalId: 't', text: 'x' })
const saved: JsonValue | null = await occ.storage.get('a')
const todos: Todo[] = await occ.plugin.request('todos.list', { done: false }, { timeoutMs: 5000 })
occ.plugin.on('todos.changed', ({ count }) => count satisfies number)
occ.on('workspace.created', ({ branch }) => branch satisfies string)
// @ts-expect-error declared requests type their input
await occ.plugin.request('todos.list', { done: 'no' })
// @ts-expect-error a declared request needs its input
await occ.plugin.request('todos.add')
const loose: JsonValue = await occ.plugin.request('undeclared.name')
// @ts-expect-error title is required
await occ.host.call('notifications.show', {})
// @ts-expect-error params are strict
await occ.host.call('workspace.readContext', { extra: true })
// @ts-expect-error unknown frame event
occ.on('worktree.created', () => {})
export { branch, shown, saved, todos, loose }
`

const WORKER_MAIN = `
import type { Activate, OCCWorkerApi } from 'occ/worker'
import type { Todo } from './protocol'
const activate: Activate = (occ: OCCWorkerApi) => {
  const todos: Todo[] = []
  occ.panels.handle('todos.list', async ({ done }, { panel, signal }) => {
    signal.throwIfAborted()
    occ.log(panel.id + panel.surface)
    return todos.filter((todo) => done === undefined || todo.done === done)
  })
  occ.panels.handle('todos.add', ({ title }) => {
    const todo = { id: String(todos.length), title, done: false }
    todos.push(todo)
    occ.panels.post('todos.changed', { count: todos.length })
    return todo
  })
  // @ts-expect-error a handler answers with the declared output
  occ.panels.handle('todos.add', () => ({ id: 1 }))
  // @ts-expect-error posts carry the declared payload
  occ.panels.post('todos.changed', { count: 'many' })
  occ.settings.onDidChange(({ key }) => void occ.settings.get(key))
  occ.commands.register('ping', async (_args, { signal }) => {
    const stored = await occ.host.call('storage.get', { key: 'pings' }, { signal })
    await occ.host.call('storage.set', { key: 'pings', value: [stored.value, { at: 1 }] })
    return (await occ.host.call('storage.keys')).keys.length
  })
  occ.events.on('workspace.created', (payload) => occ.log(payload.path + payload.branch))
  occ.events.on('agent.status.changed', ({ workspaceId, state, mainAgent }) => {
    const done: boolean = state === 'done' && mainAgent?.outcome === 'success'
    occ.log(String(workspaceId ?? done))
  })
  // @ts-expect-error frame-only method
  void occ.host.call('shell.openExternal', { url: 'https://example.com' })
  // @ts-expect-error unknown event
  occ.events.on('worktree.created', () => {})
  // @ts-expect-error storage values are JSON
  void occ.host.call('storage.set', { key: 'k', value: () => 1 })
  occ.hooks.on('terminal.send', (event, next) => {
    if (event.text.includes('rm -rf /')) {
      return { deny: 'blocked' }
    }
    return next({ ...event, text: event.text.trim() })
  })
  occ.hooks.on('workspace.create.after', async ({ path }) => occ.log(path))
  // @ts-expect-error a deny carries its reason
  occ.hooks.on('terminal.send', () => ({ deny: 1 }))
  // @ts-expect-error unknown hook
  occ.hooks.on('terminal.write', () => {})
}
export default activate
`

const COMPONENTS_PANEL = `
import { atom, Button, read, Stack, update, host, plugin, settings, on } from 'occ'
import type { Todo } from './protocol'
const count = atom(0)
const todos = atom<Todo[]>('todos', [], { persist: 'storage' })
void plugin.request('todos.add', { title: 'x' }).then((todo) => todo.title satisfies string)
plugin.on('todos.changed', ({ count }) => count satisfies number)
on('agent.status.changed', ({ state }) => state satisfies string)
void settings.get('apiUrl')
export default function Panel() {
  return (
    <Stack gap="md">
      <Button onPress={() => update(count, (n) => n + 1)}>{read(count) + read(todos).length}</Button>
      <Button onPress={() => void host.call('notifications.show', { title: 'x' })}>Notify</Button>
    </Stack>
  )
}
`

const PANEL_TEST = `
import { mockHost, mount, assert } from 'occ/testing'
import Panel from './panel'
import type { Todo } from './protocol'
const done: Todo = { id: '1', title: 'x', done: true }
const host = mockHost({
  requests: { 'todos.list': () => [done], 'todos.add': ({ title }) => ({ ...done, title }) },
  storage: { todos: [] },
  settings: { apiUrl: 'https://example.com' }
})
const panel = await mount(Panel, { host })
await panel.post('todos.changed', { count: 1 })
await panel.emit('agent.status.changed', { workspaceId: null, paneKey: 'p', state: 'done', receivedAt: 1 })
// @ts-expect-error posts carry the declared payload
await panel.post('todos.changed', { count: 'one' })
assert.deepEqual(panel.persisted.storage, host.data().storage)
`

const EDITOR_TEST = `
import { assert, mockEditorHost } from 'occ/testing'
const host = mockEditorHost({ text: 'a' }, { colorScheme: 'light' })
const doc = await host.occ.document!.session({ debounceMs: 0 })
doc.change(doc.value + 'b')
host.conflictNext('outside')
await host.flush()
assert.equal(host.text, 'ab')
host.edits[0]?.refused satisfies string | undefined
host.dispose()
`

describe('author typings', () => {
  it('checks in the host typings generated from the host API table', () => {
    const checkedIn = readFileSync(path.join(REPO_ROOT, PLUGIN_HOST_TYPINGS_FILE), 'utf8')
    // Run `pnpm generate:plugin-author-typings` when this fails.
    expect(checkedIn).toBe(renderPluginHostTypings())
  })

  it('type-check a frame script, a worker main and a components panel', () => {
    const program = authorTypingsProgram({
      'protocol.ts': PROTOCOL,
      'panel/app.ts': FRAME_SCRIPT,
      'main.ts': WORKER_MAIN,
      'src/panel.tsx': COMPONENTS_PANEL,
      'src/protocol.ts': PROTOCOL,
      'src/panel.test.ts': PANEL_TEST,
      'editor/sync.test.ts': EDITOR_TEST
    })
    expect(authorTypingsDiagnostics(program)).toEqual([])
  })
})
