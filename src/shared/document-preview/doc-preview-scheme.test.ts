import { describe, expect, it } from 'vitest'
import { parseDocPreviewUrl } from './doc-preview-scheme'

const GRANT = 'a'.repeat(32)

describe('doc preview URLs', () => {
  it('rejects malformed grant ids and other schemes', () => {
    expect(parseDocPreviewUrl('occ-preview://SHORT/index.html')).toBeNull()
    expect(parseDocPreviewUrl(`occ-preview://${'g'.repeat(32)}/index.html`)).toBeNull()
    expect(parseDocPreviewUrl(`https://${GRANT}/index.html`)).toBeNull()
    expect(parseDocPreviewUrl('not a url')).toBeNull()
  })

  it('rejects an undecodable percent sequence rather than passing raw bytes through', () => {
    expect(parseDocPreviewUrl(`occ-preview://${GRANT}/%E0%A4%A.html`)).toBeNull()
  })
})
