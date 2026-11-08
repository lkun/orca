import {
  canSourceOwnerOpenInOCC,
  type HttpLinkActionDestinations
} from '@/lib/browser/navigation/http-link-destinations'
import type { HttpLinkSourceOwner } from '@/lib/browser/navigation/http-link-routing'

export function isMacPlatform(): boolean {
  return navigator.userAgent.includes('Mac')
}

function terminalLinkActionHintPrefix(showActions: boolean): string {
  return showActions ? 'Click for actions, ' : ''
}

export function getTerminalFileOpenHint(showActions = true): string {
  const prefix = terminalLinkActionHintPrefix(showActions)
  return isMacPlatform()
    ? `${prefix}⌘+click to open, or ⇧⌘+click for default app`
    : `${prefix}Ctrl+click to open, or Shift+Ctrl+click for default app`
}

export function getTerminalOCCFileOpenHint(showActions = true): string {
  const prefix = showActions ? 'Click for actions or ' : ''
  return isMacPlatform()
    ? `${prefix}⌘+click to open in OCC`
    : `${prefix}Ctrl+click to open in OCC`
}

// Why: Shift+modifier on a local HTML file always takes the other link-routing destination.
export function getTerminalHtmlFileOpenHint(
  destinations: HttpLinkActionDestinations,
  showActions = true
): string {
  return getTerminalUrlOpenHint({
    openLinksInApp: destinations.primary === 'occ',
    modifierInverts: true,
    showActions
  })
}

export type TerminalUrlOpenHintOptions = {
  openLinksInApp?: boolean
  modifierInverts?: boolean
  showActions?: boolean
}

// Why: remote owners advertise OCC only when their existing browser route is eligible.
export function terminalUrlOpenHintOptionsFor(
  settings:
    | {
        openLinksInApp?: boolean
        openLinksInAppModifierInverts?: boolean
        activeRuntimeEnvironmentId?: string | null
      }
    | null
    | undefined,
  sourceOwner?: HttpLinkSourceOwner,
  canOpenOwnedBrowser = false
): TerminalUrlOpenHintOptions {
  const sourceCanOpenInOCC = sourceOwner
    ? canSourceOwnerOpenInOCC(sourceOwner, canOpenOwnedBrowser)
    : !settings?.activeRuntimeEnvironmentId?.trim()
  return {
    openLinksInApp: settings?.openLinksInApp === true,
    modifierInverts: settings?.openLinksInAppModifierInverts === true && sourceCanOpenInOCC
  }
}

// With inversion, Shift means the other destination; name the resolved one instead of always promising the system browser.
export function getTerminalUrlOpenHint(options: TerminalUrlOpenHintOptions = {}): string {
  const invertsToOCC = options.modifierInverts === true && options.openLinksInApp !== true
  const prefix = terminalLinkActionHintPrefix(options.showActions !== false)
  if (invertsToOCC) {
    return isMacPlatform()
      ? `${prefix}⌘+click to open, or ⇧⌘+click to open in OCC`
      : `${prefix}Ctrl+click to open, or Shift+Ctrl+click to open in OCC`
  }
  return isMacPlatform()
    ? `${prefix}⌘+click to open, or ⇧⌘+click for system browser`
    : `${prefix}Ctrl+click to open, or Shift+Ctrl+click for system browser`
}

export function getTerminalUrlSystemBrowserHint(): string {
  return isMacPlatform() ? '⇧⌘+click for system browser' : 'Shift+Ctrl+click for system browser'
}

// Invert the hint too when plain click already opens the system browser.
export function getTerminalUrlOCCBrowserHint(): string {
  return isMacPlatform() ? '⇧⌘+click to open in OCC' : 'Shift+Ctrl+click to open in OCC'
}

export function getTerminalWorktreePathOpenHint(
  canOpenWithSystemDefault: boolean,
  showActions = true
): string {
  const prefix = terminalLinkActionHintPrefix(showActions)
  if (!canOpenWithSystemDefault) {
    const directPrefix = showActions ? 'Click for actions or ' : ''
    return isMacPlatform()
      ? `${directPrefix}⌘+click to switch workspace`
      : `${directPrefix}Ctrl+click to switch workspace`
  }

  return isMacPlatform()
    ? `${prefix}⌘+click to switch workspace, or ⇧⌘+click to open in Finder`
    : `${prefix}Ctrl+click to switch workspace, or Shift+Ctrl+click to open folder`
}
