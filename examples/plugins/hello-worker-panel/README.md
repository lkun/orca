# Hello Worker Panel

A components panel written in TSX with no build step, and the plugin's own worker. Start from
[hello-tsx](../hello-tsx) for a panel alone; this one adds everything a panel can reach beyond its
own UI, so it runs as a full-access (`trusted-worker`) plugin. OCC transpiles `src/*.tsx` and
`src/*.ts` when the panel loads (types stripped, JSX compiled for `occ`, relative imports such as
`./todos` resolved to their files).

```sh
occ plugin dev load .   # also writes .occ/types, the typings tsconfig.json extends
npx tsc -p .             # optional type check
```

Import only `occ` and relative files: there is no bundler, so `import 'react'` fails with an
error naming the file and the import.

It shows one of each part of the API:

- **Components**: keyed atoms, `derived` values, `setup(ctx)` and `ui.has` feature detection.
- **Panel → worker**: Suggest calls `plugin.request('tasks.suggest')`, answered by
  `occ.panels.handle` in `worker/main.mjs`, which starts on the panel's first request.
- **Worker → panel**: the worker `occ.panels.post`s `tasks.allDone` when the last task is done;
  the panel hears it with `plugin.on`.
- **Shared storage**: the task list is `atom('todos', ..., { persist: 'storage' })`, so the
  worker reads the same value with `occ.storage.get('todos')` and hears each change.
- **Settings**: `contributes.settings` declares `celebrate`, `suggestions` and `suggestionOrder` (a switch, a text box and a picker); change them under
  the plugin in OCC's Settings and the worker reads them with `occ.settings.get`.
- **Events**: `on('agent.status.changed')` counts working agents (the `agent:read` capability).
- **One typed contract**: `src/protocol.ts` declares `PluginRequests` and `PluginPanelEvents` in
  `declare module 'occ'`, so both sides type-check against it.
