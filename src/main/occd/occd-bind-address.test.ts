import { describe, expect, it } from 'vitest'
import {
  bindHostIsNetworkExposed,
  OCCD_LOOPBACK_BIND_HOST,
  OCCdBindAddressError,
  resolveOCCdBindHost
} from './occd-bind-address'

describe('resolveOCCdBindHost', () => {
  it('defaults to loopback when the operator asked for nothing', () => {
    expect(resolveOCCdBindHost()).toBe(OCCD_LOOPBACK_BIND_HOST)
    expect(OCCD_LOOPBACK_BIND_HOST).toBe('127.0.0.1')
  })

  it('accepts literal IPv4 and IPv6 addresses, including explicit wide binds', () => {
    expect(resolveOCCdBindHost('0.0.0.0')).toBe('0.0.0.0')
    expect(resolveOCCdBindHost('10.1.2.3')).toBe('10.1.2.3')
    expect(resolveOCCdBindHost('::1')).toBe('::1')
    expect(resolveOCCdBindHost('localhost')).toBe('127.0.0.1')
    expect(resolveOCCdBindHost(' 127.0.0.1 ')).toBe('127.0.0.1')
  })

  it('refuses hostnames, because DNS would decide which interface got bound', () => {
    expect(() => resolveOCCdBindHost('internal.example')).toThrow(OCCdBindAddressError)
    expect(() => resolveOCCdBindHost('')).toThrow(OCCdBindAddressError)
    expect(() => resolveOCCdBindHost('0.0.0.0:80')).toThrow(OCCdBindAddressError)
  })
})

describe('bindHostIsNetworkExposed', () => {
  it('separates local-only addresses from network-reachable ones', () => {
    expect(bindHostIsNetworkExposed('127.0.0.1')).toBe(false)
    expect(bindHostIsNetworkExposed('127.5.5.5')).toBe(false)
    expect(bindHostIsNetworkExposed('::1')).toBe(false)
    expect(bindHostIsNetworkExposed('0.0.0.0')).toBe(true)
    expect(bindHostIsNetworkExposed('::')).toBe(true)
    expect(bindHostIsNetworkExposed('10.1.2.3')).toBe(true)
  })
})
