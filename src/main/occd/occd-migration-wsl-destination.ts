// In-place WSL moves require the desktop-launched occd in the source distro to own the unchanged paths.
import type { OCCdMigrationManifestSource } from '../../shared/occd-migration/occd-migration-manifest'
import { isOCCdMigrationLocalWslSource } from '../../shared/occd-migration/occd-migration-source-kind'
import { isWslHostOCCdProcess } from '../ipc/wsl-guest-windows-drive-path'
import { OCCD_WSL_DISTRO_GUID_ENV } from '../../shared/occd-server-launch-env'

export const OCCD_MIGRATION_SOURCE_NOT_THIS_HOST = 'occd_migration_source_not_this_host'

export { OCCD_WSL_DISTRO_GUID_ENV }

export function servesLocalWslMigrationSource(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  return isWslHostOCCdProcess(env, platform)
}

// E2E hosts stand in for a WSL host's occd; a real one is identified by isWslHostOCCdProcess.
export const OCC_E2E_WSL_MOVE_DESTINATION_ENV = 'OCC_E2E_WSL_MOVE_DESTINATION'

/**
 * Whether this host is a WSL move's destination: it installs moved panes' terminal history and
 * serves their stored scrollback. Every other host keeps that wire surface off.
 */
export function servesWslMovedPaneHistory(env: NodeJS.ProcessEnv = process.env): boolean {
  return isWslHostOCCdProcess(env) || env[OCC_E2E_WSL_MOVE_DESTINATION_ENV] === '1'
}

export function assertOCCdMigrationSourceServedHere(
  source: OCCdMigrationManifestSource,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): void {
  if (!isOCCdMigrationLocalWslSource(source)) {
    return
  }
  // WSL distro names and their UNC forms are case-insensitive.
  const distro = env.WSL_DISTRO_NAME?.trim().toLowerCase()
  if (!servesLocalWslMigrationSource(env, platform) || distro !== source.distro.toLowerCase()) {
    throw new Error(OCCD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
  // Re-registering a distro reuses its name, not its files; require its registry ID when supplied.
  const guid = env[OCCD_WSL_DISTRO_GUID_ENV]?.trim().toLowerCase()
  if (source.distroGuid !== undefined && guid !== source.distroGuid.toLowerCase()) {
    throw new Error(OCCD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
}
