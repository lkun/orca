import {
  COMMON_FILES,
  manifest,
  readme,
  type PluginTemplate,
  type PluginTemplateInput
} from './plugin-template-files'

// Sandboxed-frame templates: they run code, so loading them needs `--approve`.

const FRAME_STYLE = `body {
        margin: 0;
        padding: 12px;
        font: 13px system-ui, sans-serif;
        color: var(--occ-foreground);
        background: var(--occ-background);
      }`

export function panel(input: PluginTemplateInput): PluginTemplate {
  return {
    description: 'Right-sidebar panel in a sandboxed frame (needs --approve to load)',
    files: {
      'occ-plugin.json': manifest(input, 'A sidebar panel.', {
        execution: 'sandboxed-ui',
        pluginApi: 1,
        contributes: {
          panels: [{ id: input.id, title: input.name, icon: 'puzzle', entry: 'panel/index.html' }]
        },
        capabilities: [{ kind: 'workspace:read' }]
      }),
      'panel/index.html': `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${FRAME_STYLE}
    </style>
  </head>
  <body>
    <h1>${input.name.replace(/[<>&]/g, '')}</h1>
    <p id="workspace">Loading…</p>
    <script>
      const label = document.getElementById('workspace')
      async function refresh() {
        if (!occ.host.has('workspace.readContext')) {
          label.textContent = 'This OCC cannot read workspace context.'
          return
        }
        try {
          const context = await occ.host.call('workspace.readContext', {})
          label.textContent = JSON.stringify(context, null, 2)
        } catch (error) {
          label.textContent = error.code + ': ' + error.message
        }
      }
      void refresh()
    </script>
  </body>
</html>
`,
      'README.md': readme(
        input,
        'A right-sidebar panel. It runs in a sandboxed frame and calls host methods its `capabilities` allow through `window.occ`. Loading it needs approval: `occ plugin dev watch .` prints the exact access and the `--approve` fingerprint.'
      ),
      ...COMMON_FILES
    }
  }
}
