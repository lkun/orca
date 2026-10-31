import { join } from 'node:path'
import { hashOCCdLauncher } from '../../shared/occd-build-identity'
import { OCCD_LAUNCHER_FILENAME } from '../../shared/occd-artifacts'

export function computeLocalOCCdBuildHash(localOCCdDir: string): string {
  return hashOCCdLauncher(join(localOCCdDir, OCCD_LAUNCHER_FILENAME))
}
