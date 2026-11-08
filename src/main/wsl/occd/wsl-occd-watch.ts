/** Hold an unwritten bridge as liveness watch/port probe: occd closes it on socket loss or distro stop. Measured exits arrive ~69ms/~40ms respectively; exit codes still require independent liveness evidence. */
import type { OCCdHostTransport } from '../../ssh/occd-host-transport'
import { openOCCdStdioBridgeChannel, resolveOCCdStdioBridge } from '../../ssh/occd-stdio-bridge'
import {
  OCCdStdioBridgeDecoder,
  type OCCdStdioBridgeSignal
} from '../../managed-server/lifecycle/occd-stdio-bridge-stream'
import type { RemoteCommandChannel } from '../../managed-server/install/remote-install-transport'

export type WslOCCdWatch = {
  /** `ready` holds a live channel; anything else holds nothing. */
  signal: 'ready' | 'refused' | 'unverifiable'
  /** Called once, with the bridge's exit code, when a `ready` watch ends on its own. */
  onExit(listener: (code: number | null) => void): void
  close(): void
  /** Whether it currently proves occd answers on its port (false while it holds no open path). */
  proving(): boolean
  /** Called each time it stops proving without an exit, so the next check can come sooner. */
  onIdle?(listener: () => void): void
}

const WATCH_OPEN_TIMEOUT_MS = 10_000

function inertWatch(signal: 'refused' | 'unverifiable'): WslOCCdWatch {
  return { signal, onExit: () => {}, close: () => {}, proving: () => false }
}

export async function openWslOCCdWatch(
  transport: OCCdHostTransport,
  port: number,
  timeoutMs = WATCH_OPEN_TIMEOUT_MS
): Promise<WslOCCdWatch> {
  let channel: RemoteCommandChannel
  try {
    channel = await openOCCdStdioBridgeChannel(
      transport,
      await resolveOCCdStdioBridge(transport, port)
    )
  } catch {
    return inertWatch('unverifiable')
  }
  return watchChannel(channel, timeoutMs)
}

/** Exported for tests: any channel speaking the bridge's sentinel protocol. */
export function watchChannel(
  channel: RemoteCommandChannel,
  timeoutMs: number
): Promise<WslOCCdWatch> {
  const decoder = new OCCdStdioBridgeDecoder('raw')
  let exitCode: number | null = null
  let ended = false
  let closedByUs = false
  let exitListener: ((code: number | null) => void) | null = null
  const close = (): void => {
    closedByUs = true
    try {
      channel.close()
    } catch {
      // Already gone.
    }
    decoder.destroy()
  }
  channel.on('exit', (code: unknown) => {
    exitCode = typeof code === 'number' ? code : null
  })
  channel.on('error', () => {})
  decoder.on('error', () => {})
  decoder.resume()
  channel.pipe(decoder)
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => settle('unverifiable'), timeoutMs)
    function settle(signal: OCCdStdioBridgeSignal | 'unverifiable'): void {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (signal !== 'ready') {
        close()
        resolve(inertWatch(signal === 'refused' ? 'refused' : 'unverifiable'))
        return
      }
      resolve({
        signal: 'ready',
        onExit: (listener) => {
          exitListener = listener
          if (ended && !closedByUs) {
            listener(exitCode)
          }
        },
        close,
        proving: () => !ended && !closedByUs
      })
    }
    decoder.on('signal', (signal: OCCdStdioBridgeSignal) => settle(signal))
    channel.on('close', (code: unknown) => {
      ended = true
      exitCode ??= typeof code === 'number' ? code : null
      settle('unverifiable')
      if (!closedByUs) {
        exitListener?.(exitCode)
        exitListener = null
      }
    })
  })
}
