import { describe, expect, it } from 'vitest'
import {
  classifyWslOCCdLiveness,
  nextWslLivenessProbe,
  type WslLivenessEvidence
} from './wsl-occd-liveness-verdict'

const INSTANCE = 'boot-a:100'
const OCCD = '321:5000'

function evidence(overrides: Partial<WslLivenessEvidence> = {}): WslLivenessEvidence {
  return {
    trigger: { source: 'bridge', code: 1 },
    running: { status: 'confirmed', running: true },
    expected: { distroInstance: INSTANCE, occd: OCCD },
    ...overrides
  }
}

describe('classifyWslOCCdLiveness', () => {
  it('reads a failed running-list probe as unverifiable, never exited, whatever the exit code', () => {
    for (const code of [0, 1, null]) {
      const verdict = classifyWslOCCdLiveness(
        evidence({ trigger: { source: 'bridge', code }, running: { status: 'unavailable' } })
      )
      expect(verdict).toEqual({ kind: 'unverifiable', reason: 'running-list-unavailable' })
    }
  })

  it('marks every terminal exited when the distro is confirmed stopped', () => {
    const verdict = classifyWslOCCdLiveness(
      evidence({ running: { status: 'confirmed', running: false } })
    )
    expect(verdict).toEqual({ kind: 'distro-stopped', corroborated: true })
  })

  it('needs no exit code to prove a stop, but only a failed exit corroborates it', () => {
    const stopped = { status: 'confirmed', running: false } as const
    expect(
      classifyWslOCCdLiveness(evidence({ trigger: { source: 'verify' }, running: stopped }))
    ).toEqual({ kind: 'distro-stopped', corroborated: false })
    expect(
      classifyWslOCCdLiveness(
        evidence({ trigger: { source: 'holder', code: 0 }, running: stopped })
      )
    ).toEqual({ kind: 'distro-stopped', corroborated: false })
  })

  it('treats a running distro whose guest did not answer as unverifiable', () => {
    expect(classifyWslOCCdLiveness(evidence({ identity: null }))).toEqual({
      kind: 'unverifiable',
      reason: 'guest-unanswered'
    })
  })

  it('proves a restart from a new boot id or pid 1 start time, without any wall clock', () => {
    const verdict = classifyWslOCCdLiveness(
      evidence({ identity: { distroInstance: 'boot-a:900', occd: null } })
    )
    expect(verdict).toEqual({ kind: 'distro-restarted' })
  })

  it('reads a gone or reused occd pid in the same incarnation as occd exited', () => {
    for (const occd of [null, '321:7777']) {
      const verdict = classifyWslOCCdLiveness(
        evidence({
          trigger: { source: 'bridge', code: 0 },
          identity: { distroInstance: INSTANCE, occd }
        })
      )
      expect(verdict).toEqual({ kind: 'occd-exited' })
    }
  })

  it('keeps occd live when the same process still runs, even after a bridge exit', () => {
    expect(
      classifyWslOCCdLiveness(
        evidence({
          trigger: { source: 'bridge', code: 0 },
          identity: { distroInstance: INSTANCE, occd: OCCD }
        })
      )
    ).toEqual({ kind: 'live' })
  })

  it('falls back to the port when no occd pid was known', () => {
    const base = evidence({
      expected: { distroInstance: INSTANCE, occd: null },
      identity: { distroInstance: INSTANCE, occd: null }
    })
    expect(classifyWslOCCdLiveness({ ...base, occdPort: 'ready' })).toEqual({ kind: 'live' })
    expect(classifyWslOCCdLiveness({ ...base, occdPort: 'refused' })).toEqual({
      kind: 'occd-exited'
    })
    expect(classifyWslOCCdLiveness({ ...base, occdPort: 'unverifiable' })).toEqual({
      kind: 'unverifiable',
      reason: 'occd-unanswered'
    })
  })
})

describe('nextWslLivenessProbe', () => {
  it('never probes inside a distro that is not confirmed running (an exec would boot it)', () => {
    expect(nextWslLivenessProbe(evidence({ running: { status: 'unavailable' } }))).toBeNull()
    expect(
      nextWslLivenessProbe(evidence({ running: { status: 'confirmed', running: false } }))
    ).toBeNull()
  })

  it('asks for identity first, and for the port only when no pid identity can decide', () => {
    expect(nextWslLivenessProbe(evidence())).toBe('identity')
    expect(
      nextWslLivenessProbe(evidence({ identity: { distroInstance: INSTANCE, occd: OCCD } }))
    ).toBeNull()
    const noPid = evidence({
      expected: { distroInstance: INSTANCE, occd: null },
      identity: { distroInstance: INSTANCE, occd: null }
    })
    expect(nextWslLivenessProbe(noPid)).toBe('occd-port')
    expect(nextWslLivenessProbe({ ...noPid, occdPort: 'refused' })).toBeNull()
    expect(
      nextWslLivenessProbe({ ...noPid, identity: { distroInstance: 'other', occd: null } })
    ).toBeNull()
  })
})
