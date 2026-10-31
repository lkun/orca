import type { SkillBundleInstallResult } from '../../shared/skill-bundle-install-contract'

const MAX_ERROR_CATEGORIES = 32
const SAFE_ERROR_CATEGORY = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export type SkillBundleObservationSummary = {
  attributes: Record<string, number>
  errocctegories: Map<string, number>
}

function increment(attributes: Record<string, number>, key: string): void {
  attributes[key] = (attributes[key] ?? 0) + 1
}

function recordErrocctegory(categories: Map<string, number>, value: string): void {
  const category = SAFE_ERROR_CATEGORY.test(value) ? value : 'other'
  const key =
    categories.has(category) || (category !== 'other' && categories.size < MAX_ERROR_CATEGORIES - 1)
      ? category
      : 'other'
  categories.set(key, (categories.get(key) ?? 0) + 1)
}

export function summarizeSkillBundleObservation(
  result: SkillBundleInstallResult
): SkillBundleObservationSummary {
  const attributes: Record<string, number> = {
    skillCount: result.skills.length,
    placementCount: 0,
    conflictCount: 0
  }
  const errocctegories = new Map<string, number>()
  for (const skill of result.skills) {
    increment(attributes, `${skill.status}SkillCount`)
    if (skill.conflict) {
      increment(attributes, 'conflictCount')
      increment(attributes, `${skill.conflict.kind}ConflictCount`)
    }
    if (skill.errocctegory) {
      recordErrocctegory(errocctegories, skill.errocctegory)
    }
    for (const placement of skill.placements) {
      increment(attributes, 'placementCount')
      increment(attributes, `${placement.topology}PlacementCount`)
      increment(attributes, `${placement.status}PlacementCount`)
      if (placement.errocctegory) {
        recordErrocctegory(errocctegories, placement.errocctegory)
      }
    }
  }
  return { attributes, errocctegories }
}
