import { describe, expect, it } from 'vitest'
import {
  emitOCCdProfileStateAuthoritySelected,
  formatOCCdProfileStateAuthoritySelected,
  type OCCdProfileStateAuthoritySelection
} from './occd-profile-state-telemetry'

const selection: OCCdProfileStateAuthoritySelection = {
  backend: 'sqlite',
  classification: 'json-only',
  authority_mode: 'sqlite-established',
  runtime: 'occd',
  migrated: true
}

describe('occd profile-state telemetry', () => {
  it('strips unexpected runtime fields before writing the record', () => {
    const selectionWithRuntimeFields = Object.assign({}, selection, {
      database_path: '/private/profile-state.db'
    })
    const line = formatOCCdProfileStateAuthoritySelected(selectionWithRuntimeFields)
    expect(line).not.toContain('database_path')
  })

  it('never lets a failing sink block startup', () => {
    expect(() =>
      emitOCCdProfileStateAuthoritySelected(selection, () => {
        throw new Error('closed stderr')
      })
    ).not.toThrow()
  })
})
