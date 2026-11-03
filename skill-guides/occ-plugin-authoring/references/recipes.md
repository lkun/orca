# Plugin recipes: panels, workers, editors and data

Hand-written companion to the `occ-plugin-authoring` guide.

## A panel backed by its own worker

A plugin's panels and its worker are one program. Use this when a panel needs Node, long work,
secrets or state the worker also uses; a panel alone needs none of it. It needs `main`, so the
plugin is `trusted-worker`. `OCC plugin create <dir> --template worker-panel` scaffolds one
(protocol, worker, panel and tests for both); example `hello-worker-panel` adds settings and events.

- Declare the contract once in a file both include (`src/protocol.ts`):
  `declare module 'occ' { interface PluginRequests { 'todos.list': { input: { done?: boolean }; output: Todo[] } } interface PluginPanelEvents { 'todos.changed': { count: number } } }`.
  Declared names are typed on both sides; any other name carries JSON.
- Worker: `occ.panels.handle(name, async (input, { panel, signal }) => output)` answers;
  `occ.panels.post(event, payload, { panel? })` pushes to every open panel of the plugin, or to
  `panel.id` from a request. Answers are JSON (1 MiB); posts 256 KiB, 200 per 10 s.
- Panel: `plugin.request(name, input, { signal, timeoutMs })` (frames: `occ.plugin.request`)
  starts the worker when needed; `plugin.on(event, handler)` hears posts. It rejects with
  `unknown_method` (no handler), `timeout` (default 30 s, max 120 s; the handler's `signal` aborts
  then and when the panel closes), `unavailable` (no worker), or the `code` the handler threw.
- The worker's `main` must `export default function activate(occ)`; a named
  `export function activate` is never called. It runs once when the worker starts; an optional
  `export function deactivate()` is awaited before it stops. An idle worker stops and restarts on
  its next command, event or panel request.
- `OCC plugin dev request <dir|plugin-key> <name> --data '<json>'` calls a handler the way
  `plugin.request` does and prints its answer, with no panel open.

## Storage, settings and secrets

- Every surface shares the plugin's `storage` (`storage:own`), `settings` (`settings:own`) and
  `secrets` (`secrets:own`), each with `onDidChange(({ key }) => ...)` heard on all surfaces.
- `atom('todos', [], { persist: 'storage' })` keeps an atom in storage under its key: the worker
  reads `occ.storage.get('todos')`, and its writes update the atom. Unversioned.
- `contributes.settings` (with `settings:own`) declares settings the user edits under the plugin
  in OCC's Settings: `{ key, title, type: 'string'|'number'|'integer'|'boolean', default, enum,
  minimum, maximum, multiline, ... }`. `settings.get(key)` reads the user's value or the default.

## Live agent status in a panel

`sandboxed-ui` is enough; capabilities `agent:read` and `workspace:read`. Panels hear workspace and
agent events with `on(...)` (frames: `occ.on`) without `contributes.events`.

1. In `setup(ctx)`, `host.call('agents.list')` once: each agent's `terminalId`, `title`, `agent`,
   `state` and `stateStartedAt` in the focused workspace.
2. Push `on('agent.status.changed', ({ terminalId, title, state }) => ...)` into
   `ctx.subscriptions` and update the row with that `terminalId` (the id `workspace.readContext`
   lists and `terminal.sendText` takes; `paneKey` is OCC's own id).
3. Push `on('workspace.changed', ...)` too and re-run `agents.list`: it fires once with the
   current context as you subscribe, then when focus moves or terminals open, close or are
   renamed, with the new `readContext` answer in `context`.
4. Keep the rows in an atom and render them as a `Table` (or `List`/`ListItem`); show "since" with
   a `{ type: 'relative', at: stateStartedAt }` cell, which OCC keeps current. Never poll.
5. Test it with `mockHost({ results: { 'agents.list': { agents: [...] } } })` and
   `panel.emit('agent.status.changed', payload)`.

## Reacting to events in a worker

List each in `contributes.events` (`{ "on": "<event>" }`) with the capability `references/events.md`
shows, then `occ.events.on(event, handler)` in `activate(occ)`. Fire one at the dev plugin with
`OCC plugin dev emit . <event> --data '<json>'`, or unit-test it with `mountWorker` (see
`references/workflow.md`).

## A status bar item a worker updates

Declare it in `contributes.statusBarItems` (`{ "id", "text"?, "icon"?, "tone"?, "tooltip"?,
"command"? }`, `engines.occ` `>=1.4.248`); a static item needs only `declarative`, and pressing it
runs `command`, one of the plugin's own `contributes.commands`. From a worker, change it with
`occ.host.call('statusBar.update', { id, text, tone, tooltip, visible })`; fields you leave out
keep their value and `visible: false` hides it. Bind a key to the same command with
`contributes.keybindings` (`{ "command", "key": "Mod+Shift+K" }`).
`OCC plugin shot <plugin-key> --status-bar` saves a PNG of the status bar with the item drawn.

## Changing or refusing what OCC does (hooks)

`trusted-worker` with `main`; list each hook in `contributes.hooks` (`{ "event": "terminal.send" }`)
and set `engines.occ` to at least `>=1.4.248`. Events, results and what `next` may change are in
`references/host-api.md` (Hooks). Start from `OCC plugin create <dir> --template hook`.

```ts
export default function activate(occ: OCCWorkerApi) {
  occ.hooks.on('terminal.send', (event) => {
    if (event.text.includes('rm -rf /')) return { deny: 'blocked by my mod' }
    // Returning nothing passes the event on unchanged; `next({ ...event, text })` rewrites it.
  })
}
```

Other hooks: `workspace.create.before`/`.after`, `agent.launch.before` (change the command line or
add `env`; the agent's own environment is never shown) and `agent.prompt.before` (rewrite a prompt
OCC submits to an agent), and `agent.tool.before`/`.after` (a tool call an agent makes; Claude
Code waits, so `{ deny }` refuses the call and `next` can change its `input`), and
`editor.save.before` (format on save: return `next({ ...event, text: formatted })`, or `{ deny }` to
stop the save; autosaves are not hooked).

Return `{ deny }` to stop, nothing (or `next(event)`) to pass. Past 2 s or on a throw OCC carries
on as if the hook passed and logs it (`OCC plugin logs`); a guard that must fail closed lists the
hook as `{ "event": "terminal.send", "onError": "deny" }`. Decide before any other awaited call:
`await occ.host.call('notifications.show', …)` ahead of `return { deny }` can throw or time out and
let the action through, so count blocks after deciding (`void occ.host.call(...)`). Unit-test with
`(await mountWorker(worker)).hooks.fire('terminal.send', event)`, which returns
`{ kind: 'continue', event }` or `{ kind: 'deny', reason }`; against the loaded dev plugin,
`OCC plugin dev hook . terminal.send --data '<json>'` prints the same decision.

## A rich editor with a library

A `sandboxed-ui` custom editor around a canvas or diagram library; start from
`OCC plugin create <dir> --template editor`. Set `"frame": "isolated"` on the editor
(`engines.occ` `>=1.4.248`) so browser clients open the file in Source instead of a fallback.
There is no bundler or network: copy the library's ESM build into the plugin and map it,
`<script type="importmap">{ "imports": { "lib": "./vendor/lib.js" } }</script>` (16 MiB a script,
1 MiB a `.ts` file; no `eval`). For types, write a small declaration beside the copied file
(`vendor/lib.d.ts` for `lib.js`, `.d.mts` for `.mjs`) with only the exports you use, and import
it by relative path; a package's split `.d.ts` files rarely resolve once copied. Style from the `--occ-*` variables in `references/host-api.md`
and redo it on `occ.on('theme', ...)`. OCC keeps no undo for editors: the library's own undo
gets Cmd/Ctrl+Z.

```ts
// editor/sync.ts: the only code that talks to OCC; merge by id, never by array position.
export const start = () =>
  occ.document.session<Scene>({
    decode: (content) => (content.kind === 'text' ? JSON.parse(content.text) : { elements: [] }),
    encode: (scene) => ({ kind: 'text', text: JSON.stringify(scene) }),
    merge: (base, outside, mine) => mergeById(base, outside, mine)
  })
// editor/main.ts: `const doc = await start()`, then library.load(doc.value),
// library.onChange((scene) => doc.change(scene)), doc.onReplace((scene) => library.load(scene)).

// editor/sync.test.ts, run by `OCC plugin test`:
import { assert, mockEditorHost, test } from 'occ/testing'
test('merges an agent write that lands while an edit waits', async () => {
  const host = mockEditorHost({ text: '{"elements":[]}' })
  const doc = await (await import('./sync.ts')).start()
  doc.change({ elements: [{ id: 'b' }] })
  host.replace('{"elements":[{"id":"a"}]}') // the agent writes first
  await host.flush() // as a save: conflict, merge, resend
  assert.deepEqual(JSON.parse(host.text ?? '').elements, [{ id: 'a' }, { id: 'b' }])
  doc.dispose()
  host.dispose()
})
```

`merge` covers both outside writes: one that lands while an edit waits (base: your last accepted
value), and one made on disk while the tab has unsaved edits (base: the disk text those edits
started from; the tab stays unsaved with the result and OCC shows no banner, for a local file
in one editor view). Without `merge` an
outside write wins and the draft is dropped, and a disk write under unsaved edits gets OCC's
Reload/Overwrite banner. `OCC plugin check <dir> --json`
then reads every file the entry loads without running it, and
`OCC plugin open <plugin-key> --editor <file>` shows it on a real file.
`OCC plugin shot <plugin-key> --editor <file> --theme dark` saves a PNG of the editor on that
file, without changing it; read the image to check what you built.

## Driving workspaces, terminals and agents from a worker

A `trusted-worker` can act as the `occ` CLI does, on whichever host owns the workspace:
`host.call('workspace.list')` (`workspace:read`) for ids, kinds, paths and branches;
`terminal.create({ workspaceId, command })` (`terminal:send`) then `terminal.read({ terminalId,
maxLines })` (`terminal:read`) for its output; `agent.launch({ workspaceId, agent: 'claude', prompt })`
(`agent:launch`); `workspace.open({ workspaceId })`, `editor.open({ workspaceId, path })` (a path
inside it) and `commands.run({ action })` (a built-in `contributes.commands[].action`, never a plugin's
replacement) need `workspace:write` and the desktop app. Panels get none.

## Replacing one of OCC's own actions

Give a worker command `"replaces": "view.tasks"` (any action a declarative `action` may name;
`engines.occ` `>=1.4.248`) and register it with `occ.commands.register`. OCC runs it when that
action fires from its shortcut, the palette or a menu, and its own action when the worker fails or
takes over 2 s. To wrap OCC's own, call `occ.host.call('commands.run', { action: 'view.tasks' })`
(`workspace:write`) from the command: it always runs the built-in. The person can switch the
replacement back on the plugin's page.
