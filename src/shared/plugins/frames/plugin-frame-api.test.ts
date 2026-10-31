// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPluginPanelShellHtml, type PluginFrameSurface } from './plugin-panel-shell'

/** The injected `window.occ` is the public frame API; the envelope under it stays internal. */

type FrameOCC = {
  api: { major: number; minor: number }
  host: {
    call: (method: string, params?: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>
    has: (method: string) => boolean
  }
  on: (event: string, handler: (payload: unknown) => unknown) => { dispose: () => void }
  document?: {
    get: () => Promise<unknown>
    onDidChange: (handler: (document: unknown) => void) => { dispose: () => void }
    applyEdit: (edit: unknown) => Promise<unknown>
  }
}

const realParent = window.parent

afterEach(() => {
  Object.defineProperty(window, 'parent', { value: realParent, configurable: true })
})

function mountShell(surface: PluginFrameSurface = 'panel') {
  const parent = { postMessage: vi.fn() }
  Object.defineProperty(window, 'parent', { value: parent, configurable: true })
  const script = buildPluginPanelShellHtml('<main></main>', surface).match(
    /<script>\n([\s\S]*?)<\/script>/
  )?.[1]
  // Configurable only so happy-dom can tear down; the frame's copy stays locked.
  window.eval(script!.replaceAll('configurable: false', 'configurable: true'))
  const occ: FrameOCC = Object.getOwnPropertyDescriptor(window, 'occ')?.value
  const fromHost = (data: unknown, source: unknown = parent) =>
    window.dispatchEvent(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the shim only compares source identity.
      new MessageEvent('message', { data, source: source as Window })
    )
  const posted = () => parent.postMessage.mock.calls.map(([message]) => message)
  return { occ, parent, fromHost, posted }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('window.occ', () => {
  it('is frozen, announces ready with the protocol, and knows api and methods up front', () => {
    const { occ, posted } = mountShell()
    expect(Object.isFrozen(occ)).toBe(true)
    expect(Object.isFrozen(occ.host)).toBe(true)
    expect(posted()).toEqual([{ occ: 1, kind: 'evt', event: 'ready', payload: { protocol: 1 } }])
    expect(occ.api).toEqual({ major: 1, minor: 0 })
    expect(occ.host.has('workspace.readContext')).toBe(true)
    expect(occ.host.has('terminal.sendText')).toBe(false)
    expect(occ.document).toBeUndefined()
  })

  it('takes api and methods from hello', () => {
    const { occ, fromHost } = mountShell()
    fromHost({
      occ: 1,
      kind: 'evt',
      event: 'hello',
      payload: { api: { major: 1, minor: 3 }, methods: ['future.method'], theme: null }
    })
    expect(occ.api).toEqual({ major: 1, minor: 3 })
    expect(occ.host.has('future.method')).toBe(true)
    expect(occ.host.has('workspace.readContext')).toBe(false)
  })

  it('resolves a call with its result and rejects with code, retryable and retryAfterMs', async () => {
    const { occ, fromHost, posted } = mountShell()
    const ok = occ.host.call('workspace.readContext', {})
    const limited = occ.host.call('notifications.show', { title: 'x' })
    const unknown = occ.host.call('notifications.show', { title: 'y' })
    expect(posted().slice(1)).toEqual([
      { occ: 1, kind: 'req', id: 0, method: 'workspace.readContext', params: {} },
      { occ: 1, kind: 'req', id: 1, method: 'notifications.show', params: { title: 'x' } },
      { occ: 1, kind: 'req', id: 2, method: 'notifications.show', params: { title: 'y' } }
    ])
    fromHost({ occ: 1, kind: 'res', id: 0, result: null })
    fromHost({
      occ: 1,
      kind: 'res',
      id: 1,
      error: { code: 'rate_limited', message: 'slow', retryable: true, retryAfterMs: 250 }
    })
    fromHost({ occ: 1, kind: 'res', id: 2, error: { code: 'from_the_future', message: 'x' } })
    await expect(ok).resolves.toBeNull()
    await expect(limited).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'slow',
      retryable: true,
      retryAfterMs: 250
    })
    await expect(unknown).rejects.toMatchObject({ code: 'action_failed', retryable: false })
  })

  it('ignores answers that do not come from the host window', async () => {
    const { occ, fromHost } = mountShell()
    const call = occ.host.call('workspace.readContext')
    fromHost({ occ: 1, kind: 'res', id: 0, result: 'spoofed' }, window)
    fromHost({ occ: 1, kind: 'res', id: 0, result: 'real' })
    await expect(call).resolves.toBe('real')
  })

  it('cancels through an AbortSignal: rejects at once and tells the host', async () => {
    const { occ, posted } = mountShell()
    const controller = new AbortController()
    const call = occ.host.call('workspace.readContext', {}, { signal: controller.signal })
    controller.abort()
    await expect(call).rejects.toMatchObject({ code: 'cancelled' })
    expect(posted().at(-1)).toEqual({ occ: 1, kind: 'cancel', id: 0 })
    await expect(
      occ.host.call('workspace.readContext', {}, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('answers pings itself and delivers events to disposable listeners', () => {
    const { occ, fromHost, posted } = mountShell()
    fromHost({ occ: 1, kind: 'evt', event: 'ping', payload: 4 })
    expect(posted().at(-1)).toEqual({ occ: 1, kind: 'evt', event: 'pong', payload: 4 })
    const onTheme = vi.fn()
    const subscription = occ.on('theme', onTheme)
    fromHost({ occ: 1, kind: 'evt', event: 'theme', payload: { colorScheme: 'dark', tokens: '' } })
    subscription.dispose()
    fromHost({
      occ: 1,
      kind: 'evt',
      event: 'theme',
      payload: { colorScheme: 'light', tokens: '' }
    })
    expect(onTheme).toHaveBeenCalledTimes(1)
    expect(onTheme).toHaveBeenCalledWith({ colorScheme: 'dark' })
  })
})

describe('window.occ.document', () => {
  const doc = (version: number, text: string) => ({
    occ: 1,
    kind: 'evt',
    event: 'editor.document',
    payload: { version, readOnly: false, content: { kind: 'text', text } }
  })

  it('gets the latest document, reports changes and applies versioned edits', async () => {
    const { occ, fromHost, posted } = mountShell('editor')
    const document = occ.document!
    const first = document.get()
    fromHost(doc(1, 'a'))
    await expect(first).resolves.toMatchObject({ version: 1, content: { text: 'a' } })
    const changes = vi.fn()
    document.onDidChange(changes)
    // A late subscriber gets the document already in, then every later one.
    await flush()
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }))
    fromHost(doc(2, 'b'))
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ version: 2 }))
    expect(changes).toHaveBeenCalledTimes(2)
    await expect(document.get()).resolves.toMatchObject({ version: 2 })

    const applied = document.applyEdit({ baseVersion: 2, content: { kind: 'text', text: 'c' } })
    expect(posted().at(-1)).toEqual({
      occ: 1,
      kind: 'req',
      id: 0,
      method: 'editor.applyEdit',
      params: { baseVersion: 2, content: { kind: 'text', text: 'c' } }
    })
    fromHost({
      occ: 1,
      kind: 'res',
      id: 0,
      error: { code: 'conflict', message: 'stale', retryable: true }
    })
    await expect(applied).rejects.toMatchObject({ code: 'conflict', retryable: true })
  })

  it('awaits editor.flush handlers before answering the host', async () => {
    const { occ, fromHost, posted } = mountShell('editor')
    let finish!: () => void
    occ.on('editor.flush', () => new Promise<void>((resolve) => (finish = resolve)))
    fromHost({ occ: 1, kind: 'req', id: 7, method: 'editor.flush' })
    await flush()
    expect(posted().some((message) => message.kind === 'res')).toBe(false)
    finish()
    await flush()
    expect(posted().at(-1)).toEqual({ occ: 1, kind: 'res', id: 7, result: null })
  })

  it('forwards modifier chords for OCC shortcuts', () => {
    const { posted } = mountShell('editor')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', metaKey: true }))
    expect(posted().at(-1)).toMatchObject({
      kind: 'evt',
      event: 'editor.keydown',
      payload: { key: 's', code: 'KeyS', metaKey: true, ctrlKey: false }
    })
  })
})

describe('hello-occ example panel', () => {
  it('talks to OCC only through window.occ', async () => {
    const html = readFileSync(
      join(process.cwd(), 'examples', 'plugins', 'hello-occ', 'panel.html'),
      'utf8'
    )
    expect(html).not.toContain('postMessage')
    document.body.innerHTML = html.match(/<body>([\s\S]*?)<script>/)?.[1] ?? ''
    const { fromHost, posted } = mountShell()
    window.eval(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '')
    document.getElementById('ctx')!.click()
    expect(posted().at(-1)).toMatchObject({ kind: 'req', method: 'workspace.readContext' })
    fromHost({
      occ: 1,
      kind: 'res',
      id: 0,
      result: { branch: 'main', displayName: 'Repo', terminals: [{ id: 't' }] }
    })
    await flush()
    expect(document.getElementById('status')!.textContent).toBe('Repo on branch main · 1 terminal')
  })
})
