// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPluginGuestShellHtml, type PluginFrameSurface } from './plugin-panel-shell'
import { flush, mountShell, type FrameOCC } from './plugin-frame-shell-mount.test-fixture'

describe('window.occ', () => {
  it('times out a call the host never answers, and bounds calls in flight', async () => {
    vi.useFakeTimers()
    try {
      const { occ, posted } = mountShell()
      const lost = occ.host.call('workspace.readContext', {})
      const outcome = lost.then(
        () => 'resolved',
        (error: { code?: string }) => error.code
      )
      await vi.advanceTimersByTimeAsync(120_000)
      await expect(outcome).resolves.toBe('timeout')
      expect(posted().at(-1)).toMatchObject({ kind: 'cancel' })
      const flood = Array.from({ length: 256 }, () =>
        occ.host.call('workspace.readContext', {}).catch(() => undefined)
      )
      await expect(occ.host.call('workspace.readContext', {})).rejects.toMatchObject({
        code: 'rate_limited'
      })
      void flood
    } finally {
      vi.useRealTimers()
    }
  })

  it('is frozen, announces ready with the protocol, and knows api and methods up front', () => {
    const { occ, posted } = mountShell()
    expect(Object.isFrozen(occ)).toBe(true)
    expect(Object.isFrozen(occ.host)).toBe(true)
    expect(posted()).toEqual([{ occ: 1, kind: 'evt', event: 'ready', payload: { protocol: 1 } }])
    expect(occ.api).toEqual({ major: 1, minor: 2 })
    expect(occ.shell).toBeUndefined()
    expect(occ.files).toBeUndefined()
    expect(occ.host.has('shell.openExternal')).toBe(false)
    expect(occ.host.has('workspace.readContext')).toBe(true)
    expect(occ.host.has('terminal.sendText')).toBe(false)
    expect(occ.host.has('plugin.request')).toBe(true)
    expect(Object.isFrozen(occ.plugin)).toBe(true)
    expect(Object.isFrozen(occ.storage)).toBe(true)
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

/** The guest shell over a fake preload transport; `fromHost` delivers like ipcRenderer.on. */
function mountGuestShell(surface: PluginFrameSurface = 'panel') {
  Reflect.deleteProperty(window, 'occ')
  const send = vi.fn()
  let receive: (message: unknown) => void = () => {}
  Object.defineProperty(window, '__occPluginFrameTransport', {
    value: { send, subscribe: (fn: (message: unknown) => void) => (receive = fn) },
    configurable: true
  })
  const script =
    buildPluginGuestShellHtml('<main></main>', surface)
      .match(/<script>\n([\s\S]*?)<\/script>/)?.[1]
      ?.replaceAll('configurable: false', 'configurable: true') ?? ''
  window.eval(script)
  const occ: FrameOCC = Object.getOwnPropertyDescriptor(window, 'occ')?.value
  const posted = () => send.mock.calls.map(([message]) => message)
  return { occ, fromHost: (data: unknown) => receive(data), posted }
}

function setUserActivation(isActive: boolean | null): void {
  Object.defineProperty(navigator, 'userActivation', {
    value: isActive === null ? undefined : { isActive },
    configurable: true
  })
}

describe('window.occ user-gesture methods', () => {
  afterEach(() => setUserActivation(null))

  it('refuse without transient activation and never reach the host', async () => {
    const { occ, posted } = mountGuestShell()
    setUserActivation(false)
    await expect(occ.shell!.openExternal('https://example.com')).rejects.toMatchObject({
      code: 'not_permitted'
    })
    await expect(occ.files!.saveAs({ data: 'x' })).rejects.toMatchObject({ code: 'not_permitted' })
    expect(posted()).toHaveLength(1)
  })

  it('call the host with activation, sending bytes as an ArrayBuffer', () => {
    const { occ, posted } = mountGuestShell()
    setUserActivation(true)
    void occ.shell!.openExternal('https://example.com/docs')
    void occ.files!.saveAs({
      suggestedName: 'chart.png',
      mimeType: 'image/png',
      data: new Uint8Array([1, 2, 3]).subarray(1)
    })
    const [open, save] = posted().slice(1)
    expect(open).toMatchObject({
      kind: 'req',
      method: 'shell.openExternal',
      params: { url: 'https://example.com/docs' }
    })
    expect(save).toMatchObject({
      kind: 'req',
      method: 'files.saveAs',
      params: { suggestedName: 'chart.png', mimeType: 'image/png' }
    })
    expect(save.params.data).toBeInstanceOf(ArrayBuffer)
    expect([...new Uint8Array(save.params.data)]).toEqual([2, 3])
  })
})

describe('window.occ saveAs and locale', () => {
  afterEach(() => setUserActivation(null))

  it('resolves a save and a cancelled dialog alike, with their status', async () => {
    const { occ, fromHost } = mountGuestShell()
    setUserActivation(true)
    const saved = occ.files!.saveAs({ data: 'a' })
    const cancelled = occ.files!.saveAs({ data: 'b' })
    fromHost({ occ: 1, kind: 'res', id: 0, result: { status: 'saved' } })
    fromHost({ occ: 1, kind: 'res', id: 1, result: { status: 'cancelled' } })
    await expect(saved).resolves.toEqual({ status: 'saved' })
    await expect(cancelled).resolves.toEqual({ status: 'cancelled' })
  })

  it("follows OCC's UI locale from hello, falling back to navigator.language", () => {
    const { occ, fromHost } = mountGuestShell()
    expect(occ.locale).toBe(navigator.language)
    fromHost({ occ: 1, kind: 'evt', event: 'hello', payload: { locale: 'de-DE', theme: null } })
    expect(occ.locale).toBe('de-DE')
  })
})

describe('guest window.occ', () => {
  const guestScript = (surface: PluginFrameSurface = 'panel') =>
    buildPluginGuestShellHtml('<main></main>', surface)
      .match(/<script>\n([\s\S]*?)<\/script>/)?.[1]
      ?.replaceAll('configurable: false', 'configurable: true') ?? ''

  it('takes the preload transport once, before plugin code can see it', async () => {
    Reflect.deleteProperty(window, 'occ')
    const send = vi.fn()
    let receive: ((message: unknown) => void) | null = null
    Object.defineProperty(window, '__occPluginFrameTransport', {
      value: { send, subscribe: (fn: (message: unknown) => void) => (receive = fn) },
      configurable: true
    })
    window.eval(guestScript())
    expect('__occPluginFrameTransport' in window).toBe(false)
    expect(send).toHaveBeenCalledWith({
      occ: 1,
      kind: 'evt',
      event: 'ready',
      payload: { protocol: 1 }
    })
    const occ: FrameOCC = Object.getOwnPropertyDescriptor(window, 'occ')?.value
    const answer = occ.host.call('workspace.readContext', {})
    receive!({ occ: 1, kind: 'res', id: 0, result: { ok: true } })
    await expect(answer).resolves.toEqual({ ok: true })
    // Window messages are not the guest channel.
    window.dispatchEvent(
      new MessageEvent('message', { data: { occ: 1, kind: 'evt', event: 'ping', payload: 1 } })
    )
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('defines no window.occ without the preload', () => {
    Reflect.deleteProperty(window, 'occ')
    window.eval(guestScript())
    expect('occ' in window).toBe(false)
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
