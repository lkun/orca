import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OCCD_VERSION, occdArtifactFilenames } from '../../src/shared/occd-artifacts.ts'
import { readOCCdMobileWebAssetFilenames } from './occd-mobile-web-bundle.mjs'

/** The runtime enters through `.runtime-node`'s executableSha256 string, never its bytes (design D2). */
export function computeOCCdFullVersion(artifactDir, { target, agentBrowserFilename }) {
  const hash = createHash('sha256')
  for (const filename of occdArtifactFilenames(
    target,
    readOCCdMobileWebAssetFilenames(artifactDir)
  )) {
    const artifactPath = join(artifactDir, filename)
    if (!existsSync(artifactPath)) {
      throw new Error(
        `occd declares ${filename} in OCCD_ARTIFACTS but never emitted it. Add the build ` +
          'step, or drop it from src/shared/occd-artifacts.ts.'
      )
    }
    hash.update(readFileSync(artifactPath))
  }
  if (agentBrowserFilename && existsSync(join(artifactDir, agentBrowserFilename))) {
    hash.update(readFileSync(join(artifactDir, agentBrowserFilename)))
  }
  return `${OCCD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}
