import { describe, expect, it } from 'vitest'
import { OCCD_STARTUP_TIMING_PREFIX } from './occd-startup-timing'
import {
  medianOCCdStartupTiming,
  parseOCCdStartupTimingLine,
  type OCCdStartupTimingReport
} from './occd-startup-timing-summary'

const run = (readyMs: number, phases: OCCdStartupTimingReport['phases']) => ({ readyMs, phases })

describe('parseOCCdStartupTimingLine', () => {
  it('reads the report after the prefix in a log line', () => {
    const report = run(900, [['daemon', 590, 760]])
    expect(
      parseOCCdStartupTimingLine(`2026 ${OCCD_STARTUP_TIMING_PREFIX}${JSON.stringify(report)}`)
    ).toEqual(report)
  })

  it('returns null for lines without a well-formed report', () => {
    expect(parseOCCdStartupTimingLine('')).toBeNull()
    expect(parseOCCdStartupTimingLine(`${OCCD_STARTUP_TIMING_PREFIX}{`)).toBeNull()
    expect(
      parseOCCdStartupTimingLine(`${OCCD_STARTUP_TIMING_PREFIX}{"readyMs":1,"phases":[["x",1]]}`)
    ).toBeNull()
  })
})

describe('medianOCCdStartupTiming', () => {
  it('takes per-key medians, with boot as the time before the first phase', () => {
    expect(
      medianOCCdStartupTiming([
        run(900, [
          ['cli-launcher', 600, 610],
          ['rpc', 850, 870]
        ]),
        null,
        run(820, [
          ['cli-launcher', 520, 530],
          ['rpc', 770, 800]
        ]),
        run(910, [
          ['cli-launcher', 610, 620],
          ['rpc', 860, 870]
        ])
      ])
    ).toEqual({
      readyMs: 900,
      bootMs: 600,
      phaseEndMs: { 'cli-launcher': 610, rpc: 870 },
      phaseMs: { 'cli-launcher': 10, rpc: 20 }
    })
  })

  it('leaves out a phase some runs lack', () => {
    expect(
      medianOCCdStartupTiming([
        run(5, [
          ['a', 1, 2],
          ['b', 2, 3]
        ]),
        run(5, [['a', 1, 2]])
      ])?.phaseEndMs
    ).toEqual({ a: 2 })
  })

  it('is null with no measured runs', () => {
    expect(medianOCCdStartupTiming([null])).toBeNull()
  })
})
