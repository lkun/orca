import type { PLUGIN_DECLARATIVE_MESSAGES } from '../plugin-declarative-message-names'
import type { OCCAtom } from './declarative-atoms'
import type { OCCComponent } from './declarative-elements'

export type OCCDisposable = { dispose(): void }
/** The guest's `window.occ` (frame preload and shell), or a fake in tests. */
export type OCCBridge = {
  api?: { major: number; minor: number }
  locale?: string
  host?: {
    call(method: string, params?: unknown, options?: unknown): Promise<unknown>
    has?(method: string): boolean
  }
  on?(event: string, handler: (payload: unknown) => void): OCCDisposable
  /** The frame shell's plugin data facades (plugin-panel-shell-facades.ts). */
  plugin?: {
    request(name: string, input?: unknown, options?: unknown): Promise<unknown>
    on(event: string, handler: (payload: unknown) => void): OCCDisposable
  }
  storage?: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
    keys(): Promise<string[]>
    onDidChange(handler: (change: { key: string }) => void): OCCDisposable
  }
  settings?: {
    get(key?: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    onDidChange(handler: (change: { key: string }) => void): OCCDisposable
  }
  secrets?: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
  }
}
export type OCCColorScheme = 'light' | 'dark'
export type OCCTheme = { colorScheme: OCCColorScheme }
type PostedEvent = (typeof PLUGIN_DECLARATIVE_MESSAGES)[
  | 'render'
  | 'error'
  | 'ready'
  | 'persist'
  | 'retain']

export type OCCPanelContext = {
  /** Disposed when the panel closes or reloads. */
  subscriptions: OCCDisposable[]
  /** Aborts when the panel closes or reloads. */
  signal: AbortSignal
  /** True while the person can see the panel. */
  visible: OCCAtom<boolean>
  panel: { id: string }
}
export type OCCPanelModule = { default?: unknown; setup?: unknown }

export type OCCRuntimeOptions = {
  /** Sends one guest → host `evt`; the frame transport wraps it in the protocol envelope. */
  post(event: PostedEvent, payload: unknown): void
  bridge?: OCCBridge | null
  /** Overrides render scheduling (tests); by default renders are throttled per frame. */
  schedule?: (flush: () => void, delayMs: number) => void
  now?: () => number
  colorScheme?: OCCColorScheme
  /** Ask the host for persisted state and context, and render only once it answers. */
  awaitHydration?: boolean
}

export type OCCDeclarativeRuntime = {
  /** Unique per guest document; every message names it. */
  readonly document: string
  /** Hydrates, runs `setup`, then mounts the default export. */
  boot(module: OCCPanelModule): Promise<void>
  mount(component: OCCComponent): void
  unmount(): void
  mounted(): boolean
  /** Handles a host `ui.event`; false unless its callback is in the tree it names. */
  dispatchEvent(payload: unknown): boolean
  /** Handles a host `ui.ack`. */
  acknowledge(payload: unknown): void
  /** Handles a host `ui.hydrate`. */
  hydrate(payload: unknown): void
  /** Renders now if an update is pending, and posts pending persisted changes. */
  flush(): void
  /** Renders the mounted component again now. */
  rerender(): void
  /** Logs `error` and posts it as `ui.error`, located at its first plugin stack frame. */
  report(error: unknown): void
  readonly themeAtom: OCCAtom<OCCTheme>
  readonly bridge: OCCBridge | null
  dispose(): void
}
