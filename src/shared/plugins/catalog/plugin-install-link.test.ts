import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_MARKETPLACE_GIT_SOURCE,
  parsePluginInstallLink,
  pluginInstallLinkFromArguments,
  PLUGIN_INSTALL_LINK_MAX_LENGTH
} from './plugin-install-link'

describe('parsePluginInstallLink', () => {
  it('defaults to the official catalog', () => {
    expect(parsePluginInstallLink('occ://plugins/acme.dusk')).toEqual({
      pluginKey: 'acme.dusk',
      catalog: { kind: 'official' }
    })
    expect(parsePluginInstallLink('occ://plugins/acme.dusk/?catalog=official')?.catalog).toEqual({
      kind: 'official'
    })
  })

  it('maps the community alias and the official URL', () => {
    expect(parsePluginInstallLink('occ://plugins/acme.dusk?catalog=community')?.catalog).toEqual({
      kind: 'community',
      source: COMMUNITY_MARKETPLACE_GIT_SOURCE
    })
    const official = encodeURIComponent('https://github.com/stablyai/orca-plugins.git')
    expect(parsePluginInstallLink(`occ://plugins/acme.dusk?catalog=${official}`)?.catalog).toEqual(
      { kind: 'official' }
    )
  })

  it.each([
    'https://gitlab.com/acme/tools/catalog.git',
    'ssh://git@github.com/acme/catalog.git',
    'git@github.com:acme/catalog.git'
  ])('accepts the catalog URL %s at main', (catalogUrl) => {
    expect(
      parsePluginInstallLink(`occ://plugins/acme.dusk?catalog=${encodeURIComponent(catalogUrl)}`)
    ).toEqual({
      pluginKey: 'acme.dusk',
      catalog: { kind: 'url', source: { kind: 'git', url: catalogUrl, ref: 'main' } }
    })
  })

  it.each([
    ['no id', 'occ://plugins/'],
    ['unqualified id', 'occ://plugins/dusk'],
    ['bad charset', 'occ://plugins/Acme.Dusk'],
    ['path traversal', 'occ://plugins/acme.dusk/../x'],
    ['prototype name', 'occ://plugins/acme.constructor'],
    ['another host', 'occ://pluginsx/acme.dusk'],
    ['extra parameter', 'occ://plugins/acme.dusk?catalog=official&install=1'],
    ['repeated catalog', 'occ://plugins/acme.dusk?catalog=official&catalog=community'],
    ['fragment', 'occ://plugins/acme.dusk#x'],
    [
      'http catalog',
      `occ://plugins/acme.dusk?catalog=${encodeURIComponent('http://example.com/c.git')}`
    ],
    ['file catalog', `occ://plugins/acme.dusk?catalog=${encodeURIComponent('file:///tmp/c')}`],
    [
      'credentials in catalog',
      `occ://plugins/acme.dusk?catalog=${encodeURIComponent('https://user:token@github.com/acme/c.git')}`
    ],
    [
      'long catalog',
      `occ://plugins/acme.dusk?catalog=https://github.com/acme/${'a'.repeat(520)}.git`
    ],
    ['reserved publisher elsewhere', 'occ://plugins/stablyai.orca-skills?catalog=community'],
    ['not a plugin link', 'occ://skills/share/abc']
  ])('rejects %s', (_label, value) => {
    expect(parsePluginInstallLink(value)).toBeNull()
  })

  it('accepts a reserved publisher only from the official catalog', () => {
    expect(parsePluginInstallLink('occ://plugins/stablyai.orca-skills')?.pluginKey).toBe(
      'stablyai.orca-skills'
    )
  })

  it('rejects an oversized link instead of trimming it valid', () => {
    const long = `occ://plugins/acme.dusk?catalog=official${'x'.repeat(PLUGIN_INSTALL_LINK_MAX_LENGTH)}`
    const captured = pluginInstallLinkFromArguments([long])
    expect(captured?.length).toBe(PLUGIN_INSTALL_LINK_MAX_LENGTH + 1)
    expect(parsePluginInstallLink(captured!)).toBeNull()
  })
})

describe('pluginInstallLinkFromArguments', () => {
  it('finds the link in Windows and Linux second-instance argv', () => {
    expect(
      pluginInstallLinkFromArguments([
        'C:\\Program Files\\OCC\\OCC.exe',
        '--allow-file-access-from-files',
        'ORCA://plugins/acme.dusk?catalog=community'
      ])
    ).toBe('ORCA://plugins/acme.dusk?catalog=community')
    expect(pluginInstallLinkFromArguments(['/usr/bin/occ', '/tmp/notes.md'])).toBeNull()
  })
})
