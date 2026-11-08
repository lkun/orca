import { afterEach, describe, expect, it } from 'vitest'
import {
  clearManagedOCCdUpdateDeferral,
  currentManagedOCCdUpdateDeferral,
  recordManagedOCCdUpdateDeferral,
  type OCCdIncumbent
} from './occd-managed-update-deferrals'

const ACTIVE = '0.1.0+fb47a73e01d4'
const CANDIDATE = '0.1.0+9150d77ce015'
const ACTIVATED_AT = '2026-11-01T10:00:00.000Z'

const NONE: OCCdIncumbent = { active: null, activatedAt: null }
const RUNNING: OCCdIncumbent = { active: ACTIVE, activatedAt: ACTIVATED_AT }

function defer(incumbent: OCCdIncumbent, candidateVersion = CANDIDATE): void {
  recordManagedOCCdUpdateDeferral(
    'env-1',
    {
      outcome: 'deferred',
      candidateVersion,
      code: 'occd_activation_fence_busy',
      reason: 'Another update holds this host.',
      forceable: false
    },
    incumbent
  )
}

afterEach(() => clearManagedOCCdUpdateDeferral('env-1'))

describe('a recorded update deferral', () => {
  it.each([
    // #38400: same release, different content hash; the versions cannot be ordered.
    [
      'another build of the same release',
      RUNNING,
      { active: '0.1.0+aaaaaaaaaaaa', activatedAt: '2026-11-02T10:00:00.000Z' }
    ],
    ['a first build', NONE, RUNNING],
    // Moved away and back between two reads: the same version, a newer activation.
    [
      'the same build activated again',
      RUNNING,
      { ...RUNNING, activatedAt: '2026-11-03T10:00:00.000Z' }
    ]
  ])('is dropped once the host moves to %s', (_label, atDeferral, movedTo) => {
    defer(atDeferral)
    expect(currentManagedOCCdUpdateDeferral('env-1', movedTo)).toBeNull()
    expect(currentManagedOCCdUpdateDeferral('env-1', atDeferral)).toBeNull()
  })

  it('is dropped when its candidate is the build the host already runs', () => {
    // An Update of the running build, refused while another desktop held the fence.
    defer(RUNNING, ACTIVE)
    expect(currentManagedOCCdUpdateDeferral('env-1', RUNNING)).toBeNull()
  })
})
