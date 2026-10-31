import type * as Monaco from 'monaco-editor'
import { PasteAction } from 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js'
import { InMemoryClipboardMetadataManager } from 'monaco-editor/esm/vs/editor/browser/controller/editContext/clipboardUtils.js'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import {
  OCC_CONTEXT_MENU_PASTE_NAME,
  OCC_CONTEXT_MENU_PASTE_PRIORITY,
  runOCCContextMenuPaste
} from './monaco-context-menu-paste'

let installed = false

/** Route Monaco Paste through trusted IPC because the sandbox blocks navigator.clipboard; install once. */
export function installMonacoContextMenuPaste(monaco: typeof Monaco): void {
  // PasteAction is absent when the browser reports no paste support.
  if (installed || !PasteAction) {
    return
  }
  installed = true

  // Priority beats Monaco’s 10000; a truthy Promise stops MultiCommand, while false yields read-only/unfocused cases to the default.
  PasteAction.addImplementation(
    OCC_CONTEXT_MENU_PASTE_PRIORITY,
    OCC_CONTEXT_MENU_PASTE_NAME,
    () =>
      runOCCContextMenuPaste({
        getFocusedEditor: () =>
          monaco.editor.getEditors().find((candidate) => candidate.hasTextFocus()) ?? null,
        readClipboardText: (options) => window.api.ui.readClipboardText(options),
        getClipboardMetadata: (text) => InMemoryClipboardMetadataManager.INSTANCE.get(text),
        emptySelectionClipboardOptionId: monaco.editor.EditorOption.emptySelectionClipboard,
        readOnlyOptionId: monaco.editor.EditorOption.readOnly,
        onTooLarge: () => {
          toast.error(
            translate(
              'auto.components.editor.MonacoEditor.largePasteTooLarge',
              'Paste is too large.'
            )
          )
        }
      })
  )
}
