import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SshTarget } from '../../../shared/ssh-types'

import { closeTestStores, createSqliteTestStore } from '../../persistence/persistence-test-harness'
import { Store } from '../../persistence/loading-store/store'
import {
  preflightOCCdMigrationExport,
  type OCCdMigrationPreflightStore
} from './ssh-target-occd-preflight'

const TARGET: SshTarget = {
  id: 'ssh-prod',
  label: 'Production',
  host: 'prod.example.com',
  port: 22,
  username: 'deploy',
  generation: 2
}

const directories: string[] = []
afterEach(async () => {
  await closeTestStores()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function preflightStore(
  configure: (store: Store) => void,
  overrides: Partial<OCCdMigrationPreflightStore> = {}
): OCCdMigrationPreflightStore {
  const directory = mkdtempSync(join(tmpdir(), 'occd-export-preflight-'))
  directories.push(directory)
  const store = createSqliteTestStore(Store, { dataFile: join(directory, 'occ-data.json') })
  configure(store)
  return {
    getSshTarget: (id) => store.getSshTarget(id),
    getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id),
    getRepos: () => store.getRepos(),
    getFolderWorkspaces: () => store.getFolderWorkspaces(),
    getProjectGroups: () => store.getProjectGroups(),
    collectOCCdMigrationSourceDormantState: (...args) =>
      store.collectOCCdMigrationSourceDormantState(...args),
    inspectOCCdMigrationUntransferredDependencies: (manifest) =>
      store.inspectOCCdMigrationUntransferredDependencies(manifest),
    ...overrides
  }
}

function withRepo(store: Store): void {
  store.addSshTarget(TARGET)
  store.addRepo({
    id: 'repo-1',
    path: '/srv/app',
    displayName: 'App',
    badgeColor: '#737373',
    addedAt: 1,
    kind: 'git',
    connectionId: TARGET.id
  })
}

describe('migration export preflight', () => {
  it('drains the catalog the target owns instead of blocking on it', () => {
    const result = preflightOCCdMigrationExport(preflightStore(withRepo), TARGET.id)
    expect(result.claimable).toBe(true)
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      'occd_migration_direct_ssh_repositories'
    ])
  })

  it('treats a census the store could not take as unverifiable, never empty', () => {
    const result = preflightOCCdMigrationExport(
      preflightStore(withRepo, {
        inspectOCCdMigrationUntransferredDependencies: () => {
          throw new Error('state unreadable')
        }
      }),
      TARGET.id
    )
    expect(result.claimable).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      'occd_migration_dependency_unverifiable'
    )
  })
})
