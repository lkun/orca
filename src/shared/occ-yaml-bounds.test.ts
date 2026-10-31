import { afterEach, describe, expect, it, vi } from 'vitest'
import { Document, stringify } from 'yaml'
import {
  MAX_OCC_YAML_BYTES,
  MAX_OCC_YAML_COLLECTION_ENTRIES,
  MAX_OCC_YAML_FIELD_BYTES,
  MAX_OCC_YAML_FIELD_CODE_UNITS
} from './occ-yaml-file-limit'
import { parseOCCYaml } from './occ-yaml'

afterEach(() => vi.restoreAllMocks())

describe('occ.yaml parse bounds', () => {
  it('admits the exact UTF-8 input boundary and rejects +1 before conversion', () => {
    const toJS = vi.spyOn(Document.prototype, 'toJS')
    const prefix = 'scripts:\n  setup: pnpm install\n#'
    const exact = prefix + ' '.repeat(MAX_OCC_YAML_BYTES - prefix.length)
    expect(parseOCCYaml(exact)).toMatchObject({ scripts: { setup: 'pnpm install' } })
    expect(toJS).toHaveBeenCalledOnce()
    toJS.mockClear()
    expect(parseOCCYaml(`${exact} `)).toBeNull()
    expect(toJS).not.toHaveBeenCalled()
  })

  it('rejects a multibyte input over the byte cap before conversion', () => {
    const toJS = vi.spyOn(Document.prototype, 'toJS')
    expect(parseOCCYaml('é'.repeat(MAX_OCC_YAML_BYTES / 2 + 1))).toBeNull()
    expect(toJS).not.toHaveBeenCalled()
  })

  it('preserves exact-size fields and drops a field at +1 code unit', () => {
    const exact = 'x'.repeat(MAX_OCC_YAML_FIELD_CODE_UNITS)
    expect(parseOCCYaml(stringify({ scripts: { setup: exact } }))).toMatchObject({
      scripts: { setup: exact }
    })
    expect(parseOCCYaml(stringify({ scripts: { setup: `${exact}x` } }))).toBeNull()
    const exactUtf8 = 'é'.repeat(MAX_OCC_YAML_FIELD_BYTES / 2)
    expect(parseOCCYaml(stringify({ scripts: { setup: exactUtf8 } }))).toMatchObject({
      scripts: { setup: exactUtf8 }
    })
    expect(parseOCCYaml(stringify({ scripts: { setup: `${exactUtf8}é` } }))).toBeNull()
  })

  it('admits the exact collection boundary and rejects +1 entries', () => {
    const tabs = Array.from({ length: MAX_OCC_YAML_COLLECTION_ENTRIES }, (_, index) => ({
      title: `tab-${index}`
    }))
    expect(parseOCCYaml(stringify({ defaultTabs: tabs }))?.defaultTabs).toHaveLength(
      MAX_OCC_YAML_COLLECTION_ENTRIES
    )
    expect(parseOCCYaml(stringify({ defaultTabs: [...tabs, { title: 'overflow' }] }))).toBeNull()
  })
})
