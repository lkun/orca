/**
 * Ownership for the [projects."<path>"] tables OCC's preflight trust writes:
 * a removed worktree's entry must die with the worktree, while a table that
 * existed at the path before OCC first wrote it stays the user's.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  removeOCCCreatedProjectTrustEntries,
  upsertOCCCreatedProjectTrustLevel
} from './trust/toml/config-toml-trust'

const PROJECT = '/tmp/worktrees/feature-r1'
const OTHER = '/tmp/worktrees/other-r1'

describe('OCC-created project trust lifecycle', () => {
  let userDataDir: string
  let managedConfigPath: string
  let accountConfigPath: string
  let previousUserDataPath: string | undefined

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'occ-pretrust-ownership-'))
    previousUserDataPath = process.env.OCC_USER_DATA_PATH
    process.env.OCC_USER_DATA_PATH = userDataDir
    const managedHome = join(userDataDir, 'codex-runtime-home', 'home')
    const accountHome = join(userDataDir, 'codex-accounts', 'acct-1', 'home')
    mkdirSync(managedHome, { recursive: true })
    mkdirSync(accountHome, { recursive: true })
    managedConfigPath = join(managedHome, 'config.toml')
    accountConfigPath = join(accountHome, 'config.toml')
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    if (previousUserDataPath === undefined) {
      delete process.env.OCC_USER_DATA_PATH
    } else {
      process.env.OCC_USER_DATA_PATH = previousUserDataPath
    }
  })

  it('removes the tables OCC created for a removed worktree, per account, and keeps other paths', async () => {
    upsertOCCCreatedProjectTrustLevel(managedConfigPath, PROJECT, 'trusted')
    upsertOCCCreatedProjectTrustLevel(accountConfigPath, PROJECT, 'trusted')
    upsertOCCCreatedProjectTrustLevel(managedConfigPath, OTHER, 'trusted')
    expect(readFileSync(managedConfigPath, 'utf-8')).toContain(`[projects."${PROJECT}"]`)

    await removeOCCCreatedProjectTrustEntries(PROJECT)

    for (const configPath of [managedConfigPath, accountConfigPath]) {
      expect(readFileSync(configPath, 'utf-8')).not.toContain(`[projects."${PROJECT}"]`)
    }
    expect(readFileSync(managedConfigPath, 'utf-8')).toContain(`[projects."${OTHER}"]`)
    // The record was forgotten, so removing again cannot touch surviving entries.
    await removeOCCCreatedProjectTrustEntries(PROJECT)
    expect(readFileSync(managedConfigPath, 'utf-8')).toContain(`[projects."${OTHER}"]`)
  })

  it('keeps a table that existed at the path before OCC wrote it', async () => {
    const userTable = [`[projects."${PROJECT}"]`, 'trust_level = "untrusted"', ''].join('\n')
    writeFileSync(managedConfigPath, userTable)
    writeFileSync(accountConfigPath, userTable)

    // The preflight grant still rewrites the trust line it always did…
    upsertOCCCreatedProjectTrustLevel(managedConfigPath, PROJECT, 'trusted')

    // …but the worktree removal must not delete the pre-existing tables.
    await removeOCCCreatedProjectTrustEntries(PROJECT)

    expect(readFileSync(managedConfigPath, 'utf-8')).toBe(
      [`[projects."${PROJECT}"]`, 'trust_level = "trusted"', ''].join('\n')
    )
    expect(readFileSync(accountConfigPath, 'utf-8')).toBe(
      [`[projects."${PROJECT}"]`, 'trust_level = "untrusted"', ''].join('\n')
    )
  })

  it('does not delete a table the user replaced after OCC created the original', async () => {
    upsertOCCCreatedProjectTrustLevel(managedConfigPath, PROJECT, 'trusted')
    const replacement = [
      `[projects."${PROJECT}"]`,
      'trust_level = "trusted"',
      'followup = "user-added"',
      ''
    ].join('\n')
    writeFileSync(managedConfigPath, replacement)

    await removeOCCCreatedProjectTrustEntries(PROJECT)

    expect(readFileSync(managedConfigPath, 'utf-8')).toBe(replacement)
    // The spent record is dropped, so a later pass cannot delete the user's table either.
    await removeOCCCreatedProjectTrustEntries(PROJECT)
    expect(readFileSync(managedConfigPath, 'utf-8')).toBe(replacement)
  })
})
