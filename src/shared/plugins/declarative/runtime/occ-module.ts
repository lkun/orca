/**
 * Entry of the guest `occ` module (also `occ/jsx-runtime` and `occ/jsx-dev-runtime`). Bundled
 * to resources/plugins/declarative/occ-runtime.mjs by config/scripts/build-plugin-declarative-runtime.mjs.
 * OCC's host page installs the runtime, imports the panel module and boots it.
 */
import { installPluginSourceMapHook } from './declarative-source-maps'
import { read, resetAtoms } from './declarative-atoms'
import type { OCCComponent } from './declarative-elements'
import {
  createOCCDeclarativeRuntime,
  type OCCBridge,
  type OCCColorScheme,
  type OCCDeclarativeRuntime,
  type OCCRuntimeOptions
} from './declarative-renderer'
import { createOCCSdk } from './declarative-sdk'
import { createOCCDataSdk } from './declarative-data-sdk'

export { atom, derived, read, set, update } from './declarative-atoms'
export { Fragment, h, jsx, jsx as jsxs, jsx as jsxDEV } from './declarative-elements'

let runtime: OCCDeclarativeRuntime | null = null
let pendingMount: OCCComponent | null = null

function isOCCBridge(value: unknown): value is OCCBridge {
  return (
    typeof value === 'object' && value !== null && 'on' in value && typeof value.on === 'function'
  )
}

function globalBridge(): OCCBridge | null {
  const scope: object = globalThis
  const candidate: unknown = 'occ' in scope ? scope.occ : undefined
  return isOCCBridge(candidate) ? candidate : null
}

function documentColorScheme(): OCCColorScheme | undefined {
  const root = typeof document === 'undefined' ? null : document.documentElement
  if (!root) {
    return undefined
  }
  return root.classList.contains('light') ? 'light' : 'dark'
}

/** Starts the runtime; `bridge` defaults to the preload's `window.occ`. Replaces any earlier one. */
export function installOCCDeclarativeRuntime(
  options: Pick<OCCRuntimeOptions, 'post'> & Partial<OCCRuntimeOptions>
): OCCDeclarativeRuntime {
  runtime?.dispose()
  resetAtoms()
  // Before the panel module loads, so its prelude registers its source map.
  installPluginSourceMapHook()
  const installed = createOCCDeclarativeRuntime({
    bridge: globalBridge(),
    colorScheme: documentColorScheme(),
    ...options
  })
  runtime = installed
  // Cleanup runs when the panel reloads or navigates away; see the lifetime contract.
  if (typeof addEventListener === 'function') {
    addEventListener('pagehide', () => installed.dispose(), { once: true })
  }
  const queued = pendingMount
  pendingMount = null
  if (queued) {
    installed.mount(queued)
  }
  return installed
}

/** Renders `component` as the panel. A module's default export is mounted the same way. */
export function mount(component: OCCComponent): void {
  if (runtime) {
    runtime.mount(component)
  } else {
    pendingMount = component
  }
}

const sdk = createOCCSdk({
  bridge: () => runtime?.bridge ?? globalBridge(),
  theme: () =>
    runtime ? read(runtime.themeAtom) : { colorScheme: documentColorScheme() ?? 'dark' }
})

export const { host, api, env, shell, files, on, ui } = sdk
export const { plugin, storage, settings, secrets } = createOCCDataSdk(
  () => runtime?.bridge ?? globalBridge()
)

// Catalog tags: JSX `<Stack>` compiles to a reference, so authors import these by name.
export const Stack = 'Stack'
export const Row = 'Row'
export const Text = 'Text'
export const Heading = 'Heading'
export const Button = 'Button'
export const IconButton = 'IconButton'
export const Badge = 'Badge'
export const Card = 'Card'
export const List = 'List'
export const ListItem = 'ListItem'
export const Input = 'Input'
export const Switch = 'Switch'
export const Select = 'Select'
export const Separator = 'Separator'
export const Progress = 'Progress'
export const Spinner = 'Spinner'
export const EmptyState = 'EmptyState'
export const Link = 'Link'
export const Code = 'Code'
// Catalog 2 (OCC 1.4.247).
export const Textarea = 'Textarea'
export const Checkbox = 'Checkbox'
export const RadioGroup = 'RadioGroup'
export const Slider = 'Slider'
export const Field = 'Field'
export const Tabs = 'Tabs'
export const Tab = 'Tab'
export const Collapsible = 'Collapsible'
export const Toolbar = 'Toolbar'
export const Grid = 'Grid'
export const Table = 'Table'
export const Tree = 'Tree'
export const Markdown = 'Markdown'
export const CodeView = 'CodeView'
export const Image = 'Image'
export const KeyValue = 'KeyValue'
export const Callout = 'Callout'
export const Skeleton = 'Skeleton'
export const RelativeTime = 'RelativeTime'
// Catalog 4 (OCC 1.4.248).
export const Box = 'Box'
