import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LEGACY_WORKSPACE_ID = 'legacy'

function getOCCDir(): string {
  return join(homedir(), '.occ')
}

function getLegacyTokenPath(): string {
  return join(getOCCDir(), 'linear-token.enc')
}

export function getLegacyViewerPath(): string {
  return join(getOCCDir(), 'linear-viewer.json')
}

export function getWorkspaceFilePath(): string {
  return join(getOCCDir(), 'linear-workspaces.json')
}

export function getWorkspaceTokenDir(): string {
  return join(getOCCDir(), 'linear-tokens')
}

export function getWorkspaceTokenPath(workspaceId: string): string {
  if (workspaceId === LEGACY_WORKSPACE_ID) {
    return getLegacyTokenPath()
  }
  return join(getWorkspaceTokenDir(), `${Buffer.from(workspaceId).toString('base64url')}.enc`)
}

export function ensureOCCDir(): void {
  const dir = getOCCDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function ensureWorkspaceTokenDir(): void {
  const dir = getWorkspaceTokenDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
