import { translate } from '@/i18n/i18n'
import {
  NATIVE_CHAT_OCC_STOP_COPY as COPY,
  type NativeChatOCCStopCopyId,
  type NativeChatOCCStopSay
} from '../../../../shared/native-chat/native-chat-occ-stop-words'

const PIECES: Record<NativeChatOCCStopCopyId, (machine: string | undefined) => string> = {
  update: (machine) =>
    translate('components.native-chat.notices.occStopUpdate', COPY.update, { machine }),
  quit: (machine) =>
    translate('components.native-chat.notices.occStopQuit', COPY.quit, { machine }),
  crash: (machine) =>
    translate('components.native-chat.notices.occStopCrash', COPY.crash, { machine }),
  remote: (machine) =>
    translate('components.native-chat.notices.occStopRemote', COPY.remote, { machine }),
  canContinue: () =>
    translate('components.native-chat.notices.occStopCanContinue', COPY.canContinue),
  unnamedServer: () =>
    translate('components.native-chat.notices.occStopUnnamedServer', COPY.unnamedServer)
}

export const sayNativeChatOCCStopTranslated: NativeChatOCCStopSay = (id, machine) =>
  PIECES[id](machine)
