import type { OCCRuntimeService } from '../occ-runtime'

export const availableRevealWorkspace: OCCRuntimeService['prepareStructuredAgentSessionRevealWorkspace'] =
  async () => ({
    current: () => true,
    check: () => {},
    release: Object.assign(() => {}, { isCurrent: () => true })
  })
