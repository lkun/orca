import { describe, expect, it } from 'vitest'
import { OCCD_MOBILE_WEB_MANIFEST, occdMobileWebAssetFilenames } from './occd-artifacts'

describe('standalone runtime artifacts', () => {
  it.each([
    ['no assets', { assets: [] }],
    ['a traversal path', { assets: [{ path: '../occd.js' }] }],
    ['an absolute path', { assets: [{ path: '/etc/passwd' }] }],
    ['a backslash path', { assets: [{ path: 'a\\b.js' }] }],
    ['a missing path', { assets: [{}] }]
  ])('refuses a page manifest with %s', (_label, manifest) => {
    expect(() => occdMobileWebAssetFilenames(JSON.stringify(manifest))).toThrow(
      OCCD_MOBILE_WEB_MANIFEST
    )
  })
})
