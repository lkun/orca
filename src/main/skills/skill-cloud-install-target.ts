import type { SkillInstallDestination } from '../../shared/skill-install-contract'
import type { OCCRuntimeService } from '../runtime/occ-runtime'

export async function classifySkillCloudInstallTarget(
  runtime: OCCRuntimeService,
  input: { environmentId?: string; destination: SkillInstallDestination }
): Promise<'local' | 'remote'> {
  return input.environmentId || (await runtime.skillInstallDestinationUsesSsh(input.destination))
    ? 'remote'
    : 'local'
}
