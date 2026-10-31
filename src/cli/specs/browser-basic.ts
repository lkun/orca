import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'
import { withBrowserPageTarget } from './browser-page-target'
import { BROWSER_WAIT_DEFAULT_TIMEOUT_MS } from '../../shared/browser-wait-timeout'

export const BROWSER_BASIC_COMMAND_SPECS: CommandSpec[] = withBrowserPageTarget([
  {
    path: ['browser', 'identity', 'get'],
    summary: 'Show the browser identity configured on this OCC host',
    usage: 'occ browser identity get [--json]',
    aliases: [['browser', 'identity', 'show']],
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['browser', 'identity', 'set'],
    summary: 'Choose the browser identity for every page on this OCC host',
    usage: 'occ browser identity set --mode <clean|native> [--reset] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mode', 'reset']
  },
  {
    path: ['open-url'],
    summary: 'Open a URL on the paired client that hosts this terminal',
    usage: 'occ open-url --url <url> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'url', 'worktree']
  },
  {
    path: ['snapshot'],
    summary: 'Capture an accessibility snapshot of the active browser tab',
    usage:
      'occ snapshot [--interactive] [--compact] [--depth <n>] [--selector <css>] [--urls] [--delta | --full] [--worktree <selector>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'interactive',
      'compact',
      'depth',
      'selector',
      'urls',
      'delta',
      'full',
      'worktree'
    ],
    notes: [
      'Without flags the snapshot is the whole accessibility tree, including page text.',
      'Each page keeps one --delta baseline: a navigation, a large change or different flags return the whole tree again and replace it.'
    ]
  },
  {
    path: ['screenshot'],
    summary: 'Save a viewport screenshot of the active browser tab and print its path',
    usage:
      'occ screenshot [--format <png|jpeg>] [--if-changed] [--annotate] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'format', 'if-changed', 'annotate', 'worktree'],
    notes: [
      "In OCC's desktop browser the image is in CSS pixels, so its x/y match page coordinates for `occ mouse`."
    ]
  },
  {
    path: ['click'],
    summary: 'Click a browser element by ref',
    usage: 'occ click --element <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree']
  },
  {
    path: ['fill'],
    summary: 'Clear and fill a browser input by ref',
    usage: 'occ fill --element <ref> --value <text> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'value', 'worktree']
  },
  {
    path: ['type'],
    summary: 'Type text at the current browser focus',
    usage: 'occ type --input <text> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'input', 'worktree']
  },
  {
    path: ['select'],
    summary: 'Select a dropdown option by ref',
    usage: 'occ select --element <ref> --value <value> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'value', 'worktree']
  },
  {
    path: ['scroll'],
    summary: 'Scroll the browser viewport',
    usage: 'occ scroll --direction <up|down> [--amount <pixels>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'direction', 'amount', 'worktree']
  },
  {
    path: ['goto'],
    summary: 'Navigate the active browser tab to a URL',
    usage: 'occ goto --url <url> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'url', 'worktree']
  },
  {
    path: ['back'],
    summary: 'Navigate back in browser history',
    usage: 'occ back [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['reload'],
    summary: 'Reload the active browser tab',
    usage: 'occ reload [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['eval'],
    summary: 'Evaluate JavaScript in the browser page context',
    usage: 'occ eval --expression <js> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'expression', 'worktree']
  },
  {
    path: ['wait'],
    summary: 'Wait for element, text, URL, load state, JS condition, or timeout',
    usage:
      'occ wait [--selector <sel>] [--timeout <ms>] [--text <text>] [--url <pattern>] [--load <state>] [--fn <js>] [--state <hidden|visible>] [--worktree <selector>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'selector',
      'timeout',
      'text',
      'url',
      'load',
      'fn',
      'state',
      'worktree'
    ],
    notes: [
      `With a condition, --timeout is how long to wait for it (default ${BROWSER_WAIT_DEFAULT_TIMEOUT_MS} ms). Without one, --timeout is a plain pause.`
    ]
  },
  {
    path: ['check'],
    summary: 'Check a checkbox/radio by ref',
    usage: 'occ check --element <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree']
  },
  {
    path: ['uncheck'],
    summary: 'Uncheck a checkbox/radio by ref',
    usage: 'occ uncheck --element <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree']
  },
  {
    path: ['focus'],
    summary: 'Focus a browser element by ref',
    usage: 'occ focus --element <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree']
  },
  {
    path: ['clear'],
    summary: 'Clear an input element by ref',
    usage: 'occ clear --element <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree']
  },
  {
    path: ['select-all'],
    summary: 'Select all text in an input by ref',
    usage: 'occ select-all --element <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree']
  },
  {
    path: ['keypress'],
    summary: 'Press a key (Enter, Tab, Escape, ArrowDown, etc.)',
    usage: 'occ keypress --key <name> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key', 'worktree']
  },
  {
    path: ['pdf'],
    summary: 'Export the active browser tab as PDF',
    usage: 'occ pdf [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['full-screenshot'],
    summary: 'Save a full-page screenshot (beyond viewport) and print its path',
    usage: 'occ full-screenshot [--format <png|jpeg>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'format', 'worktree']
  },
  {
    path: ['hover'],
    summary: 'Hover over a browser element by ref',
    usage: 'occ hover --element <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree']
  },
  {
    path: ['drag'],
    summary: 'Drag from one element to another',
    usage: 'occ drag --from <ref> --to <ref> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'from', 'to', 'worktree']
  },
  {
    path: ['upload'],
    summary: 'Upload files to a file input, or to the one a picker button opens',
    usage: 'occ upload --element <ref> --files <path,...> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'files', 'worktree']
  },
  {
    path: ['tab', 'list'],
    summary: 'List open browser tabs',
    usage: 'occ tab list [--worktree <selector|all>] [--show-profile] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'show-profile']
  },
  {
    path: ['tab', 'show'],
    summary: 'Show one browser tab by page id',
    usage: 'occ tab show --page <id> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'page', 'worktree']
  },
  {
    path: ['tab', 'current'],
    summary: 'Show the current browser tab',
    usage: 'occ tab current [--worktree <selector|all>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['tab', 'switch'],
    summary: 'Switch the active browser tab',
    usage: 'occ tab switch (--index <n> | --page <id>) [--worktree <selector>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'index', 'page', 'worktree', 'focus']
  },
  {
    path: ['tab', 'create'],
    summary: 'Create a new browser tab in the current worktree',
    usage:
      'occ tab create [--url <url>] [--worktree <selector>] [--profile <id>] [--split <right|left|down|up>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'url', 'worktree', 'profile', 'split']
  },
  {
    path: ['tab', 'profile', 'list'],
    summary: 'List browser session profiles available to browser tabs',
    usage: 'occ tab profile list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['tab', 'profile', 'create'],
    summary: 'Create a browser session profile for browser tabs',
    usage: 'occ tab profile create --label <name> [--scope <isolated|imported>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'label', 'scope']
  },
  {
    path: ['tab', 'profile', 'delete'],
    destructive: true,
    summary: 'Delete a browser session profile used by browser tabs',
    usage: 'occ tab profile delete --profile <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'profile']
  },
  {
    path: ['tab', 'profile', 'set'],
    summary: 'Switch a browser tab to a different browser profile',
    usage: 'occ tab profile set (--page <id> | --worktree <selector>) --profile <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'profile', 'page', 'worktree']
  },
  {
    path: ['tab', 'profile', 'show'],
    summary: 'Show the browser profile bound to a tab',
    usage: 'occ tab profile show --page <id> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'page', 'worktree']
  },
  {
    path: ['tab', 'profile', 'use-default'],
    summary: 'Switch a browser tab back to the default browser profile',
    usage: 'occ tab profile use-default --page <id> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'page', 'worktree']
  },
  {
    path: ['tab', 'profile', 'clone'],
    summary: 'Clone a browser tab into a different browser profile',
    usage: 'occ tab profile clone --profile <id> [--page <id>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'profile', 'page', 'worktree']
  },
  {
    path: ['tab', 'close'],
    destructive: true,
    summary: 'Close a browser tab',
    usage: 'occ tab close [--index <n>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'index', 'worktree']
  },
  {
    path: ['exec'],
    summary: 'Run any agent-browser command against the active browser tab',
    usage: 'occ exec --command "<agent-browser command>" [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'command', 'worktree']
  }
])
