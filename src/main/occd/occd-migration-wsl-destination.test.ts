import { describe, expect, it } from 'vitest'
import type { OCCdMigrationManifestSource } from '../../shared/occd-migration/occd-migration-manifest'
import {
  assertOCCdMigrationSourceServedHere,
  OCCD_MIGRATION_SOURCE_NOT_THIS_HOST
} from './occd-migration-wsl-destination'

const WSL_SOURCE: OCCdMigrationManifestSource = {
  kind: 'local-wsl',
  distro: 'Ubuntu',
  scopeRepoIds: ['repo-1'],
  scopeFolderWorkspaceIds: [],
  generation: 1
}
const WSL_HOST = { OCC_WSL_OCCD_HOST: '1', WSL_DISTRO_NAME: 'ubuntu' }

describe('WSL migration destination', () => {
  it('accepts its own distro, case-insensitively', () => {
    expect(() => assertOCCdMigrationSourceServedHere(WSL_SOURCE, WSL_HOST, 'linux')).not.toThrow()
  })

  it.each([
    ['another distro', { ...WSL_HOST, WSL_DISTRO_NAME: 'Debian' }, 'linux'],
    ['a plain Linux host', {}, 'linux'],
    ['a desktop', WSL_HOST, 'darwin']
  ] as const)('refuses a WSL source on %s', (_label, env, platform) => {
    expect(() => assertOCCdMigrationSourceServedHere(WSL_SOURCE, env, platform)).toThrow(
      OCCD_MIGRATION_SOURCE_NOT_THIS_HOST
    )
  })

  it('refuses a source from another registration of the same distro name', () => {
    const source = { ...WSL_SOURCE, distroGuid: '{AAAA}' }
    expect(() =>
      assertOCCdMigrationSourceServedHere(
        source,
        { ...WSL_HOST, OCC_WSL_DISTRO_GUID: '{aaaa}' },
        'linux'
      )
    ).not.toThrow()
    for (const env of [{ ...WSL_HOST, OCC_WSL_DISTRO_GUID: '{BBBB}' }, WSL_HOST]) {
      expect(() => assertOCCdMigrationSourceServedHere(source, env, 'linux')).toThrow(
        OCCD_MIGRATION_SOURCE_NOT_THIS_HOST
      )
    }
  })
})
