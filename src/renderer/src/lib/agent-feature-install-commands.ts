// COMPAT(wsl-bridge): removed when WSL runs as an occd host.
import { buildAgentFeatureSkillInstallCommand as buildPinnedSkillInstallCommand } from '../../../shared/agent-feature-install-commands'
import {
  OCC_CLI_SKILL_NAME,
  OCC_LINEAR_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
} from './agent-feature-skill-names'

/** The interactive install, pinned to this build; also the update, since `add` re-copies. */
export function buildAgentFeatureSkillInstallCommand(skillNames: readonly string[]): string {
  return buildPinnedSkillInstallCommand(skillNames, { sourceCommit: OCC_BUILD_COMMIT })
}

export const ORCHESTRATION_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  ORCHESTRATION_SKILL_NAME
])

export const OCC_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  OCC_CLI_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
])

export const OCC_LINEAR_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  OCC_LINEAR_SKILL_NAME
])
