import { describe, expect, it } from 'vitest'
import { eventSchemas } from './telemetry-events'

describe('occ cli feature tip schemas', () => {
  it('rejects raw CLI details and unknown result values', () => {
    expect(
      eventSchemas.occ_cli_feature_tip_setup_result.safeParse({
        source: 'app_open',
        result: 'installed',
        command_path: '/Users/alice/bin/occ'
      }).success
    ).toBe(false)
    expect(
      eventSchemas.occ_cli_feature_tip_setup_result.safeParse({
        source: 'app_open',
        result: 'installed_after_retry'
      }).success
    ).toBe(false)
  })
})
