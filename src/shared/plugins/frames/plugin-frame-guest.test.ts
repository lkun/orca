import { describe, expect, it } from 'vitest'
import {
  isPluginFrameOriginUrl,
  parsePluginFrameUrl,
  pluginFrameKey,
  pluginFramePartition,
  pluginFrameUrl,
  readPluginFramePartitionKey
} from './plugin-frame-guest'

const KEY = pluginFrameKey('acme.charts')

describe('plugin frame guest identity', () => {
  it('round-trips the partition and refuses look-alikes', () => {
    expect(pluginFramePartition(KEY)).toBe(`persist:occ-plugin-${KEY}`)
    expect(readPluginFramePartitionKey(pluginFramePartition(KEY))).toBe(KEY)
    expect(readPluginFramePartitionKey(`persist:occ-plugin-${KEY}x`)).toBeNull()
    expect(readPluginFramePartitionKey(`occ-plugin-${KEY}`)).toBeNull()
    expect(readPluginFramePartitionKey('persist:occ-plugin-../../x')).toBeNull()
  })
})

describe('plugin frame URLs', () => {
  it('builds entry URLs from manifest paths', () => {
    expect(pluginFrameUrl(KEY, 'ui/panel.html')).toBe(`occ-plugin-frame://${KEY}/ui/panel.html`)
    expect(pluginFrameUrl(KEY, './a b/#x.html')).toBe(`occ-plugin-frame://${KEY}/a%20b/%23x.html`)
  })

  it('parses contained paths into decoded segments', () => {
    expect(parsePluginFrameUrl(`occ-plugin-frame://${KEY}/ui/app.js?v=1`)).toEqual({
      frameKey: KEY,
      segments: ['ui', 'app.js'],
      reserved: false
    })
    expect(parsePluginFrameUrl(`occ-plugin-frame://${KEY}/a%20b/x.wasm`)?.segments).toEqual([
      'a b',
      'x.wasm'
    ])
    expect(parsePluginFrameUrl(`occ-plugin-frame://${KEY}/__occ/sdk.js`)?.reserved).toBe(true)
    expect(parsePluginFrameUrl(`occ-plugin-frame://${KEY}/__OCC/sdk.js`)?.reserved).toBe(true)
    expect(parsePluginFrameUrl(`occ-plugin-frame://${KEY}/__OCC/sdk.js`)?.reserved).toBe(true)
  })

  it('lets URL dot segments collapse at the plugin root, never above it', () => {
    expect(
      parsePluginFrameUrl(`occ-plugin-frame://${KEY}/ui/%2e%2e/%2e%2e/../secret`)?.segments
    ).toEqual(['secret'])
  })

  it.each([
    `occ-plugin-frame://${KEY}/`,
    `occ-plugin-frame://${KEY}/..%2Fsecret`,
    `occ-plugin-frame://${KEY}/a%5C..%5Cb`,
    `occ-plugin-frame://${KEY}/a%00b`,
    `occ-plugin-frame://${KEY}/__occ./runtime.mjs`,
    `occ-plugin-frame://${KEY}/__occ%20/runtime.mjs`,
    `occ-plugin-frame://${KEY}/panel.html.`,
    `occ-plugin-frame://${KEY}/C:%5Cwindows`,
    `occ-plugin-frame://${KEY}/bad%E0%A4%A`,
    `occ-plugin-frame://${KEY}:8080/x`,
    `occ-plugin-frame://user@${KEY}/x`,
    'occ-plugin-frame://NOTAKEY/x',
    `https://${KEY}/x`
  ])('refuses %s', (url) => {
    expect(parsePluginFrameUrl(url)).toBeNull()
  })

  it('matches only the exact plugin origin', () => {
    expect(isPluginFrameOriginUrl(`occ-plugin-frame://${KEY}/x.html`, KEY)).toBe(true)
    expect(isPluginFrameOriginUrl(`occ-plugin-frame://${pluginFrameKey('a.b')}/x`, KEY)).toBe(
      false
    )
    expect(isPluginFrameOriginUrl(`blob:occ-plugin-frame://${KEY}/uuid`, KEY)).toBe(false)
    expect(isPluginFrameOriginUrl('not a url', KEY)).toBe(false)
  })
})
