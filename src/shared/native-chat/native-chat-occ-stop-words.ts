import type { AgentSessionOCCStopCause } from '../agent-session-occ-stop'
import { joinSentences } from '../sentence-joining'

/** English pieces; desktop translates each with the same fallback, the phone keeps English. */
export const NATIVE_CHAT_OCC_STOP_COPY = {
  update: 'OCC on {{machine}} restarted for an update while this response was in progress.',
  quit: 'OCC on {{machine}} was closed while this response was in progress.',
  crash: 'OCC on {{machine}} stopped unexpectedly while this response was in progress.',
  // A remote graceful stop is a server stop or a shared desktop's quit; "stopped" is true of both.
  remote: 'OCC on {{machine}} stopped while this response was in progress.',
  canContinue: 'You can continue in this conversation.',
  unnamedServer: 'the remote server'
} as const

export type NativeChatOCCStopCopyId = keyof typeof NATIVE_CHAT_OCC_STOP_COPY
export type NativeChatOCCStopSay = (id: NativeChatOCCStopCopyId, machine?: string) => string

export const sayNativeChatOCCStopEnglish: NativeChatOCCStopSay = (id, machine) =>
  machine === undefined
    ? NATIVE_CHAT_OCC_STOP_COPY[id]
    : NATIVE_CHAT_OCC_STOP_COPY[id].replace('{{machine}}', () => machine)

/** Base wording on host continuation support so the sentence stays stable as the button changes. */
export function nativeChatOCCStopRowText(
  cause: AgentSessionOCCStopCause,
  machine: string,
  options: { continueAvailable: boolean; remoteHost: boolean },
  say: NativeChatOCCStopSay = sayNativeChatOCCStopEnglish
): string {
  const stopped = say(cause === 'quit' && options.remoteHost ? 'remote' : cause, machine)
  return options.continueAvailable ? stopped : joinSentences([stopped, say('canContinue')])
}
