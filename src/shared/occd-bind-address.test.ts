import { describe, expect, it } from 'vitest'
import { OCCdBindAddressError, resolveOCCdBindHost } from './occd-bind-address'

describe('resolveOCCdBindHost', () => {
  it('refuses hostnames, because DNS would decide which interface got bound', () => {
    expect(() => resolveOCCdBindHost('internal.example')).toThrow(OCCdBindAddressError)
    expect(() => resolveOCCdBindHost('')).toThrow(OCCdBindAddressError)
    expect(() => resolveOCCdBindHost('0.0.0.0:80')).toThrow(OCCdBindAddressError)
    expect(() => resolveOCCdBindHost('fe80::2008%eth0')).toThrow(
      'does not support scoped IPv6 addresses'
    )
  })
})
