import type { MouseEvent } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

/** Row-menu actions for the card's own issue or task; each one dismisses the hovercard. */
export type WorktreeCardTaskActionHandlers = {
  onCopyLink: (url: string) => void
  onEditIssue?: (event: MouseEvent) => void
  onOpenGitHubIssueInOCC?: (event: MouseEvent) => void
  onOpenIssueInBrowser?: (url: string) => void
  onOpenLinearIssueInOCC?: (event: MouseEvent) => void
}

async function copyWorkItemLink(url: string): Promise<void> {
  try {
    // Electron clipboard IPC survives nested overlays that can lose browser activation.
    await window.api.ui.writeClipboardText(url)
    toast.success(
      translate('auto.components.sidebar.WorktreeCardMeta.copyLinkSuccess', '{{value0}} copied', {
        value0: translate('auto.components.sidebar.WorktreeCardMeta.issueLinkLabel', 'Issue link')
      })
    )
  } catch {
    toast.error(
      translate('auto.components.sidebar.WorktreeCardMeta.copyLinkFailure', 'Failed to copy link')
    )
  }
}

function dismissing<T>(
  closeHover: () => void,
  run: ((arg: T) => void) | undefined
): ((arg: T) => void) | undefined {
  return run
    ? (arg) => {
        closeHover()
        run(arg)
      }
    : undefined
}

export function getWorktreeCardTaskActions(
  closeHover: () => void,
  handlers: Omit<WorktreeCardTaskActionHandlers, 'onCopyLink'>
): WorktreeCardTaskActionHandlers {
  return {
    onCopyLink: (url) => {
      closeHover()
      void copyWorkItemLink(url)
    },
    // Why: editing opens a dialog that owns its own dismissal of the card.
    onEditIssue: handlers.onEditIssue,
    onOpenGitHubIssueInOCC: dismissing(closeHover, handlers.onOpenGitHubIssueInOCC),
    onOpenIssueInBrowser: dismissing(closeHover, handlers.onOpenIssueInBrowser),
    onOpenLinearIssueInOCC: dismissing(closeHover, handlers.onOpenLinearIssueInOCC)
  }
}
