import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTreeSync } from '../../shared/windows-transient-lock-removal'
import type { PersistedState } from '../../shared/persisted-state-types'
import { getRepoMainWorktreeId } from '../../shared/worktree/id'
import { worktreeWorkspaceKey } from '../../shared/workspace-scope'
import {
  acquireProfileStateMaintenance,
  acquireProfileStateRuntimeAdmission
} from '../persistence/profile-state/profile-state-access'
import * as database from '../persistence/profile-state/profile-state-database'
import { exportProfileStateJson } from '../persistence/profile-state/profile-state-documents'
import { createProfileStateStore } from '../persistence/profile-state/profile-state-store-factory'
import { getOCCProfileDataFile, getOCCProfileStateDatabaseFile } from './profile-index-store'
import { initializeNewOCCProfileState } from './new-profile-state'

const telemetry = {
  optedIn: false,
  installId: 'retained-install-id',
  existedBeforeTelemetryRelease: true
}
let root: string
const profileId = 'new-profile'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'occ-profile-consent-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  removeTreeSync(root)
})

function readPublishedState(): PersistedState {
  const opened = database.openProfileStateDatabaseReadOnly(
    getOCCProfileStateDatabaseFile(profileId, root),
    profileId
  )
  try {
    const state: PersistedState = JSON.parse(exportProfileStateJson(opened.db))
    return state
  } finally {
    opened.db.close()
  }
}

describe('new desktop profile initialization', () => {
  it.each([telemetry, undefined])(
    'publishes Home with fresh defaults and consent %j',
    (inherited) => {
      const runtime = acquireProfileStateRuntimeAdmission(root)
      try {
        initializeNewOCCProfileState(profileId, inherited, root)
        const published = readPublishedState()
        const [home] = published.repos
        expect(published.repos).toHaveLength(1)
        expect(home).toMatchObject({ kind: 'folder', path: homedir() })
        expect(published.projects).toHaveLength(1)
        expect(published.projectHostSetups).toHaveLength(1)
        const worktreeId = getRepoMainWorktreeId(home)
        expect(published.workspaceSession).toMatchObject({
          activeRepoId: home.id,
          activeWorktreeId: worktreeId,
          activeWorkspaceKey: worktreeWorkspaceKey(worktreeId),
          activeWorkspaceExecutionHostId: 'local',
          activeTabId: null
        })
        expect(published.settings.telemetry).toEqual(
          inherited ??
            expect.objectContaining({
              existedBeforeTelemetryRelease: false,
              optedIn: true,
              installId: expect.any(String),
              onboardingLanguageCohort: expect.stringMatching(/^(control|treatment)$/)
            })
        )
        expect(published.settings.tabSwitchKeybindingSeed).toBe('done')
        expect(published.chatUiLaunchTipAudience).toEqual({
          version: 1,
          membership: 'excluded',
          basis: 'new-profile'
        })
        expect(published.ui).toMatchObject({
          projectOrderManualDefaultNoticeDismissed: true,
          usagePercentageDisplayChangeNoticeDismissed: true,
          statusBarCompactChangeNoticeDismissed: true
        })
        const options = {
          userDataPath: root,
          dataFile: getOCCProfileDataFile(profileId, root),
          databaseFile: getOCCProfileStateDatabaseFile(profileId, root),
          profileId,
          initializeHomeWorkspace: true
        }
        const first = createProfileStateStore(options).store
        expect(first.getRepos()).toEqual([expect.objectContaining(home)])
        expect(first.getSettings().telemetry).toEqual(published.settings.telemetry)
        expect(first.getWorkspaceSession().activeWorktreeId).toBe(worktreeId)
        first.flushOrThrow()
        first.freezeWrites()

        const reopened = createProfileStateStore(options).store
        expect(reopened.getRepos()).toEqual([expect.objectContaining(home)])
        expect(reopened.getSettings().telemetry).toEqual(published.settings.telemetry)
        reopened.removeProjectForHost({ id: home.id })
        reopened.flushOrThrow()
        reopened.freezeWrites()
        initializeNewOCCProfileState(profileId, inherited, root)
        const afterRemoval = createProfileStateStore(options).store
        expect(afterRemoval.getRepos()).toEqual([])
        afterRemoval.freezeWrites()
        expect(existsSync(getOCCProfileDataFile(profileId, root))).toBe(false)
        expect(() => runtime.assertActive()).not.toThrow()
      } finally {
        runtime.release()
      }
      const maintenance = acquireProfileStateMaintenance(root)
      maintenance.release()
    }
  )

  it('preserves established SQLite consent on a repeated seed', () => {
    initializeNewOCCProfileState(profileId, telemetry, root)
    const original = readPublishedState()
    initializeNewOCCProfileState(profileId, { ...telemetry, installId: 'replacement' }, root)
    expect(readPublishedState()).toEqual(original)
  })

  it('preserves existing JSON as input for its later import', () => {
    const path = getOCCProfileDataFile(profileId, root)
    const original = '{"settings":{"telemetry":{"installId":"older"}}}'
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, original)

    initializeNewOCCProfileState(profileId, telemetry, root)

    expect(readFileSync(path, 'utf8')).toBe(original)
    expect(existsSync(getOCCProfileStateDatabaseFile(profileId, root))).toBe(false)
  })

  it('refuses seeding while maintenance owns the root', () => {
    const maintenance = acquireProfileStateMaintenance(root)
    try {
      expect(() => initializeNewOCCProfileState(profileId, telemetry, root)).toThrow()
      expect(existsSync(getOCCProfileStateDatabaseFile(profileId, root))).toBe(false)
    } finally {
      maintenance.release()
    }
  })

  it.each(['occ-data.json.bak.0', 'occ-data.json.sqlite-export.1.json', 'profile-state.db-wal'])(
    'retains missing-authority evidence in %s',
    (name) => {
      const directory = dirname(getOCCProfileDataFile(profileId, root))
      mkdirSync(directory, { recursive: true })
      const evidence = join(directory, name)
      writeFileSync(evidence, 'retained recovery evidence')

      expect(() => initializeNewOCCProfileState(profileId, telemetry, root)).toThrow()

      expect(existsSync(getOCCProfileDataFile(profileId, root))).toBe(false)
      expect(existsSync(getOCCProfileStateDatabaseFile(profileId, root))).toBe(false)
      expect(readFileSync(evidence, 'utf8')).toBe('retained recovery evidence')
    }
  )
})
