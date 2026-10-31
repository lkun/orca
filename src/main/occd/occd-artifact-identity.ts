import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  OCCD_MOBILE_WEB_MANIFEST,
  OCCD_SERVER_TARGET_FILENAME,
  OCCD_VERSION,
  occdArtifactFilenames,
  occdMobileWebAssetFilenames
} from '../../shared/occd-artifacts'
import { COMPAT_SERVER_TARGETS, SERVER_TARGETS } from '../../shared/node-runtime-pin'
import { occdAgentBrowserNativeName } from '../../shared/occd-agent-browser-name'

/** Hash installed bytes in the build's order; a version marker is not proof of delivery. */
export async function readOCCdArtifactIdentity(directory: string): Promise<string> {
  const hash = createHash('sha256')
  for (const filename of await listOCCdArtifactFilenames(directory)) {
    for await (const chunk of createReadStream(join(directory, filename))) {
      hash.update(chunk)
    }
  }
  return `${OCCD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}

/** The installed files the artifact identity covers, in the build's order. */
export async function listOCCdArtifactFilenames(directory: string): Promise<string[]> {
  const target = z
    .enum([...SERVER_TARGETS, ...COMPAT_SERVER_TARGETS])
    .parse((await readFile(join(directory, OCCD_SERVER_TARGET_FILENAME), 'utf8')).trim())
  const platform = target.startsWith('win32-')
    ? 'win32'
    : target.startsWith('darwin-')
      ? 'darwin'
      : 'linux'
  const browser = occdAgentBrowserNativeName(
    platform,
    target.split('-')[1] ?? '',
    target.endsWith('-musl') ? 'musl' : 'glibc'
  )
  const filenames = occdArtifactFilenames(
    target,
    occdMobileWebAssetFilenames(await readFile(join(directory, OCCD_MOBILE_WEB_MANIFEST), 'utf8'))
  )
  if (existsSync(join(directory, browser))) {
    filenames.push(browser)
  }
  return filenames
}
