import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

/** Copies the chat's OCC session ID from the host: `occ_session_id:<root>`, which `/clear` keeps. */
export function NativeChatCopyOCCSessionIdMenuItem({
  resolveOCCSessionId
}: {
  resolveOCCSessionId: () => Promise<string | null>
}): React.JSX.Element {
  const copyOCCSessionId = async (): Promise<void> => {
    try {
      const occSessionId = await resolveOCCSessionId()
      if (!occSessionId) {
        throw new Error('no OCC session ID')
      }
      await window.api.ui.writeClipboardText(occSessionId)
      toast.success(
        translate(
          'components.native-chat.contextMenu.occSessionIdCopied',
          'OCC session ID copied'
        )
      )
    } catch {
      toast.error(
        translate(
          'components.native-chat.contextMenu.occSessionIdCopyFailed',
          'Unable to copy OCC session ID'
        )
      )
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem onSelect={() => void copyOCCSessionId()}>
          <Copy />
          {translate(
            'components.native-chat.contextMenu.copyOCCSessionId',
            'Copy OCC Session ID'
          )}
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-[220px]">
        {translate(
          'components.native-chat.contextMenu.occSessionIdTooltip',
          "OCC's ID for this chat, separate from the agent CLI's own session ID. Agents use it to refer to each other through OCC."
        )}
      </TooltipContent>
    </Tooltip>
  )
}
