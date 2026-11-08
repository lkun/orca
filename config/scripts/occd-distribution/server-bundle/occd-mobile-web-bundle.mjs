import { cpSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  OCCD_MOBILE_WEB_DIR,
  OCCD_MOBILE_WEB_MANIFEST,
  occdMobileWebAssetFilenames
} from '../../../../src/shared/occd-artifacts.ts'

const { MOBILE_WEB_BUNDLE_DIR, assertMobileWebBundleBuilt } = createRequire(import.meta.url)(
  '../../desktop-distribution/runtime-verification/verify-packaged-mobile-web-bundle.cjs'
)
const { assertNoDarkOutputOfOffSwitches } = createRequire(import.meta.url)(
  '../../../dark-build-switches.cjs'
)

// Require a fresh built page as beforePack does: an occd package without it cannot serve phones.
export function stageOCCdMobileWebBundle(outputDir, bundleDir = MOBILE_WEB_BUNDLE_DIR) {
  // The release template refuses the variable itself.
  assertNoDarkOutputOfOffSwitches([bundleDir])
  assertMobileWebBundleBuilt(bundleDir)
  // The guard refuses unlisted files, so the tree is the manifest, its assets and a dark marker.
  cpSync(bundleDir, join(outputDir, ...OCCD_MOBILE_WEB_DIR.split('/')), { recursive: true })
}

export function readOCCdMobileWebAssetFilenames(packageDir) {
  return occdMobileWebAssetFilenames(
    readFileSync(join(packageDir, ...OCCD_MOBILE_WEB_MANIFEST.split('/')), 'utf8')
  )
}
