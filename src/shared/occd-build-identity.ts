import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { OCCD_LAUNCHER_FILENAME, OCCD_SERVER_ENTRY_FILENAME } from './occd-artifacts'

export const OCCD_BUILD_HASH_LENGTH = 16

/** The launcher embeds its server digest, keeping the hash older clients calculate. */
export function hashOCCdLauncher(entryPath: string): string {
  const entry = realpathSync(entryPath)
  const launcher =
    basename(entry) === OCCD_SERVER_ENTRY_FILENAME
      ? join(dirname(entry), OCCD_LAUNCHER_FILENAME)
      : entry
  return createHash('sha256')
    .update(readFileSync(launcher))
    .digest('hex')
    .slice(0, OCCD_BUILD_HASH_LENGTH)
}
