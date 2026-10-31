import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS, LOCAL_COMMAND_FLAGS } from '../args'
import { PLUGIN_TEMPLATE_NAMES } from '../plugin-authoring/plugin-template-names'

const TEMPLATES = PLUGIN_TEMPLATE_NAMES.join('|')

const EXIT_CODES_NOTE =
  'Exit codes: 0 ok, 1 error, 2 the plugin is invalid (plugin_invalid), 3 approval is needed (approval_required or approval_stale).'

export const PLUGIN_AUTHORING_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['plugin', 'create'],
    summary: 'Scaffold a new OCC plugin from a template',
    usage: `occ plugin create <dir> --template <${TEMPLATES}> [--publisher <name>] [--id <id>] [--name <display name>] [--json]`,
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'dir', 'template', 'publisher', 'id', 'name'],
    positionalArgs: ['dir'],
    notes: [
      'Writes into a new or empty folder (a .git folder is allowed) and never overwrites; it runs no Git, package install or plugin code.',
      'theme, terminal-theme, icon-theme, syntax and language-pack are content only: loading them never needs approval.',
      'editor and panel run code in a sandboxed frame: loading them prints the access they ask for and needs --approve.',
      'The id defaults to the folder name. Set --publisher to the GitHub or GitLab owner of the repository you will publish from.',
      'Runs on the machine that runs this command; it does not reach the OCC app.',
      EXIT_CODES_NOTE
    ],
    examples: [
      'occ plugin create ./dusk-theme --template theme --publisher acme',
      'occ plugin create ./notes-editor --template editor --publisher acme --name "Notes" --json'
    ]
  },
  {
    path: ['plugin', 'validate'],
    summary: 'Check a plugin folder, manifest or catalog the way OCC will load it',
    usage: 'occ plugin validate <dir|occ-plugin.json|occ-catalog.json> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'path'],
    positionalArgs: ['path'],
    notes: [
      'Runs the strict checks of `pnpm validate:plugin`: manifest, limits, execution profile, every theme, icon, syntax and translation file, and every file the manifest names.',
      'Offline; never runs plugin code. The result says whether loading needs --approve and what it would grant.',
      EXIT_CODES_NOTE
    ],
    examples: ['occ plugin validate .', 'occ plugin validate ./dusk-theme --json']
  },
  {
    path: ['plugin', 'inspect'],
    summary: 'Show what a plugin folder contributes, the access it asks for, and its content hash',
    usage: 'occ plugin inspect <dir> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'path'],
    positionalArgs: ['path'],
    notes: [
      'Validates like `occ plugin validate`, then hashes the files the way install does.',
      'Use it to show your user exactly what a plugin would be allowed to do before loading it.',
      EXIT_CODES_NOTE
    ],
    examples: ['occ plugin inspect ./notes-editor --json']
  }
]

const APPROVE_NOTE =
  'Content-only plugins (themes, icons, syntaxes, translations) need no approval. Anything that runs code or acts in OCC fails with approval_required, which lists exactly what it would be granted, why, and the command to re-run with --approve <fingerprint>. The fingerprint is bound to that plugin, version, files and access; anything different needs a new one.'

export const PLUGIN_RUNTIME_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['plugin', 'list'],
    summary: 'List plugins on the OCC host with their status and access level',
    usage: 'occ plugin list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Status is running, idle, pending (waiting for approval), disabled, errored or invalid; dev marks development folders.'
    ],
    examples: ['occ plugin list --json']
  },
  {
    path: ['plugin', 'logs'],
    summary: 'Print the recent log lines of a plugin',
    usage: 'occ plugin logs <plugin-key> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'plugin'],
    positionalArgs: ['plugin'],
    notes: ['Shows the last lines a plugin worker printed and its activation errors.'],
    examples: ['occ plugin logs acme.notes --json']
  },
  {
    path: ['plugin', 'enable'],
    summary: 'Enable a plugin; code and capabilities need --approve',
    usage: 'occ plugin enable <plugin-key> [--approve <fingerprint>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'plugin', 'approve'],
    positionalArgs: ['plugin'],
    notes: [
      APPROVE_NOTE,
      'Enabling a plugin that is already approved and running needs nothing; re-enabling a disabled plugin that runs code needs --approve again.',
      EXIT_CODES_NOTE
    ],
    examples: ['occ plugin enable acme.dusk', 'occ plugin enable acme.notes --approve ap1-…']
  },
  {
    path: ['plugin', 'disable'],
    summary: 'Disable a plugin',
    usage: 'occ plugin disable <plugin-key> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'plugin'],
    positionalArgs: ['plugin'],
    notes: ['Never needs approval.'],
    examples: ['occ plugin disable acme.notes']
  },
  {
    path: ['plugin', 'dev', 'load'],
    summary: 'Load a plugin folder into OCC as a development plugin',
    usage: 'occ plugin dev load <dir> [--approve <fingerprint>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'dir', 'approve'],
    positionalArgs: ['dir'],
    notes: [
      'Adds the folder to Settings → Plugins → Development folders on the OCC host; it overrides an installed plugin with the same key.',
      'OCC reloads the plugin when its files change. For an approved panel, editor or worker, later code edits run without asking again; new access does not.',
      APPROVE_NOTE,
      'Without approval the folder stays loaded but nothing in it runs.',
      'With --environment the folder is a path on that OCC server; pass it absolute.',
      EXIT_CODES_NOTE
    ],
    examples: ['occ plugin dev load ./dusk-theme', 'occ plugin dev load ./notes-editor --json']
  },
  {
    path: ['plugin', 'dev', 'reload'],
    summary: 'Reload development plugins now, or one folder and re-check its approval',
    usage: 'occ plugin dev reload [<dir>] [--approve <fingerprint>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'dir', 'approve'],
    positionalArgs: ['dir'],
    notes: [
      'OCC already reloads on file changes; use this when a change was missed (network or WSL folders) or after changing commands or shortcuts, which need a new approval.',
      EXIT_CODES_NOTE
    ],
    examples: ['occ plugin dev reload', 'occ plugin dev reload ./notes-editor --json']
  },
  {
    path: ['plugin', 'dev', 'unload'],
    summary: 'Remove a development folder from OCC',
    usage: 'occ plugin dev unload <dir|plugin-key> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'target'],
    positionalArgs: ['target'],
    notes: [
      'Never needs approval. An installed plugin with the same key comes back, needing its own approval if access differs.'
    ],
    examples: ['occ plugin dev unload ./notes-editor', 'occ plugin dev unload acme.notes']
  }
]
