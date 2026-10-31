export const OCC_EDITOR_SAVE_DIRTY_FILES_EVENT = 'occ:editor-save-dirty-files'
export const OCC_EDITOR_PREPARE_HOT_EXIT_EVENT = 'occ:editor-prepare-hot-exit'

export type EditorSaveDirtyFilesDetail = {
  claim: () => void
  resolve: () => void
  reject: (message: string) => void
}

export type EditorPrepareHotExitDetail = EditorSaveDirtyFilesDetail
