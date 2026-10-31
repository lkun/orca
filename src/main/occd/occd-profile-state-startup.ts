import { createProfileStateStoreForStartup } from '../persistence/profile-state/profile-state-startup-authority'
import type { ProfileStateStoreFactoryResult } from '../persistence/profile-state/profile-state-store-factory'
import { ensureActiveOCCProfile, initOCCProfilePaths } from '../occ-profiles/profile-index-store'
import { initSshHostKeyStoreFile } from '../ssh/ssh-host-key-store'
import { initOCCdHeldFenceTokenFile } from '../ssh/occd-held-fence-tokens'
import { emitOCCdProfileStateAuthoritySelected } from './occd-profile-state-telemetry'
import { isWslHostOCCdProcess } from '../ipc/wsl-guest-windows-drive-path'

/** WSL hosts are held to a per-distro memory budget; the idle writer thread costs ~13-15 MB. */
export const WSL_HOST_PROFILE_WRITER_IDLE_STOP_MS = 60_000

/** SSH hosts and the desktop keep their writer thread running. */
export function occdProfileWriterIdleStopMs(
  isWslHost: () => boolean = isWslHostOCCdProcess
): number | undefined {
  return isWslHost() ? WSL_HOST_PROFILE_WRITER_IDLE_STOP_MS : undefined
}

type OCCdProfileStateStartup = {
  store: ProfileStateStoreFactoryResult['store']
  authority: {
    backend: ProfileStateStoreFactoryResult['backend']
    classification: ProfileStateStoreFactoryResult['classification']
    authority_mode: 'sqlite-established'
    runtime: 'occd'
    migrated: boolean
  }
}

export async function createOCCdProfileStateStartup(
  userDataPath: string
): Promise<OCCdProfileStateStartup> {
  initOCCProfilePaths()
  const profile = ensureActiveOCCProfile(userDataPath)
  // Real persistence avoids falsely empty RPCs; headless authority keeps automations owned by this host.
  const result = await createProfileStateStoreForStartup({
    userDataPath,
    dataFile: profile.dataFile,
    databaseFile: profile.stateDatabaseFile,
    profileId: profile.profile.id,
    runtime: 'occd',
    storageAuthority: 'runtime',
    writerIdleStopMs: occdProfileWriterIdleStopMs()
  })
  const authority = {
    backend: result.backend,
    classification: result.classification,
    authority_mode: 'sqlite-established' as const,
    runtime: 'occd' as const,
    migrated: result.migrated
  }
  try {
    initSshHostKeyStoreFile(profile.dataFile)
    initOCCdHeldFenceTokenFile(profile.dataFile)
    emitOCCdProfileStateAuthoritySelected(authority)
    return { store: result.store, authority }
  } catch (error) {
    try {
      await result.store.freezeWritesAsync()
    } catch (closeError) {
      console.error(
        '[persistence] Failed to close profile persistence after startup failure:',
        closeError
      )
    }
    throw error
  }
}
