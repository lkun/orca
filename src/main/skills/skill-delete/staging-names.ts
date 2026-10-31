/** Hide transaction siblings from discovery to avoid duplicate rows and repeat deletes. Match the shared .*.occ-* shape so native checks and WSL find-prune agree. */
export const SKILL_DELETE_STAGING_MARKER = '.occ-skill-delete-'

export const BUNDLED_SKILL_STAGE_MARKER = '.occ-stage-'
export const BUNDLED_SKILL_OLD_MARKER = '.occ-old-'

/** The `find -name` glob the WSL guest script prunes on. */
export const SKILL_STAGING_GLOB = '.*.occ-*'

const SKILL_STAGING_NAME = /^\..+\.occ-/u

export function isSkillStagingEntryName(name: string): boolean {
  return SKILL_STAGING_NAME.test(name)
}

export function skillDeleteStagedName(basename: string, id: string): string {
  return `.${basename}${SKILL_DELETE_STAGING_MARKER}${id}`
}

export function isSkillDeleteStagedName(basename: string, staged: string): boolean {
  return staged.startsWith(`.${basename}${SKILL_DELETE_STAGING_MARKER}`)
}
