export function isOCCWindowForegroundFocused(): boolean {
  if (typeof document === 'undefined' || typeof document.hasFocus !== 'function') {
    return true
  }
  return document.visibilityState === 'visible' && document.hasFocus()
}
