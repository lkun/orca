import { useCallback, useEffect } from 'react'
import { usePluginViewCaptureStore } from '@/store/plugins/capture/plugin-view-capture'

/** What `occ plugin shot --editor` waits on, per open file: the frame's load and its document. */
export type PluginEditoccptureStatus = {
  frame: 'loading' | 'ready' | 'error' | 'unresponsive'
  /** The isolated guest's URL, so main captures that guest; null for an in-page frame. */
  guestUrl: string | null
  /** A new document mounted; `delivered` and `subscribed` restart with it. */
  frameKey: string | null
  delivered: boolean
  subscribed: boolean
}

const statuses = new Map<string, PluginEditoccptureStatus>()
const listeners = new Set<() => void>()

function update(fileId: string, patch: Partial<PluginEditoccptureStatus>): void {
  const current = statuses.get(fileId) ?? {
    frame: 'loading',
    guestUrl: null,
    frameKey: null,
    delivered: false,
    subscribed: false
  }
  statuses.set(fileId, { ...current, ...patch })
  listeners.forEach((listener) => listener())
}

export function pluginEditoccptureStatus(fileId: string): PluginEditoccptureStatus | null {
  return statuses.get(fileId) ?? null
}

export function subscribePluginEditoccpture(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reports one editor frame's state while it is mounted; returns the host's progress callback. */
export function usePluginEditoccptureReport(
  fileId: string | undefined,
  frame: PluginEditoccptureStatus['frame'],
  guestUrl: string | null,
  frameKey: string | null
): (step: 'delivered' | 'subscribed') => void {
  useEffect(() => {
    if (fileId !== undefined) {
      update(fileId, { frame, guestUrl, frameKey, delivered: false, subscribed: false })
    }
  }, [fileId, frameKey, frame, guestUrl])
  useEffect(() => {
    if (fileId === undefined) {
      return
    }
    return () => {
      statuses.delete(fileId)
      listeners.forEach((listener) => listener())
    }
  }, [fileId])
  return useCallback(
    (step) => {
      if (fileId !== undefined) {
        update(fileId, step === 'delivered' ? { delivered: true } : { subscribed: true })
      }
    },
    [fileId]
  )
}

/** What a running `plugin shot --editor` asks of this file's frame: a fresh load (so the errors it
 *  reports are this load's) and, with --width/--height, its size for the capture only. */
export function usePluginEditoccptureView(fileId: string | undefined): {
  captureLoad: number
  captureSize: { width: number; height: number } | null
} {
  const captureLoad = usePluginViewCaptureStore((state) =>
    fileId === undefined ? 0 : (state.editorLoads[fileId] ?? 0)
  )
  const captureSize = usePluginViewCaptureStore((state) =>
    fileId !== undefined && state.editorFileId === fileId ? state.editorSize : null
  )
  return { captureLoad, captureSize }
}
