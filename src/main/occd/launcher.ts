import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { OCCD_SERVER_ENTRY_FILENAME } from '../../shared/occd-artifacts'
import { assertOCCdServerRuntime, handoffToBundledOCCd } from './occd-bundled-runtime'
import { OCCD_EXIT_CONFIGURATION } from './occd-configuration-exit'
import { enableManagedOCCdCompileCache } from './occd-compile-cache'

declare const OCCD_SERVER_SHA256: string

let loadServer: (() => void) | undefined

try {
  if (!handoffToBundledOCCd()) {
    assertOCCdServerRuntime()
    const entry = realpathSync(process.argv[1] ?? __filename)
    const server = join(dirname(entry), OCCD_SERVER_ENTRY_FILENAME)
    if (createHash('sha256').update(readFileSync(server)).digest('hex') !== OCCD_SERVER_SHA256) {
      throw new Error('The OCC server does not match its launcher')
    }
    loadServer = () => {
      enableManagedOCCdCompileCache(dirname(entry))
      createRequire(entry)(server)
    }
  }
} catch (error) {
  console.error('occd: failed to launch:', error)
  process.exit(OCCD_EXIT_CONFIGURATION)
}

loadServer?.()
