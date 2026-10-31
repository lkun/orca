import type { NativeChatOCCStopSay } from '../../../../../src/shared/native-chat/native-chat-occ-stop-words'
import type { Translate } from '../../../i18n/mobile-i18n'

export function nativeChatOCCStopSay(t: Translate): NativeChatOCCStopSay {
  return (id, machine) => {
    const copy = {
      update: () =>
        t(
          'chat.occStop.update',
          'OCC on {{machine}} restarted for an update while this response was in progress.',
          { machine }
        ),
      quit: () =>
        t(
          'chat.occStop.quit',
          'OCC on {{machine}} was closed while this response was in progress.',
          { machine }
        ),
      crash: () =>
        t(
          'chat.occStop.crash',
          'OCC on {{machine}} stopped unexpectedly while this response was in progress.',
          { machine }
        ),
      remote: () =>
        t(
          'chat.occStop.remote',
          'OCC on {{machine}} stopped while this response was in progress.',
          { machine }
        ),
      canContinue: () => t('chat.occStop.canContinue', 'You can continue in this conversation.'),
      unnamedServer: () => t('chat.occStop.unnamedServer', 'the remote server')
    }
    return copy[id]()
  }
}
