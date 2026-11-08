import { describe, expect, it } from 'vitest'
import { summarizeSkillMarkdown } from './skill-metadata'

describe('summarizeSkillMarkdown', () => {
  it('reads name and folded description from YAML frontmatter', () => {
    const summary = summarizeSkillMarkdown(`---
name: occ-cli
description: >-
  Use the occ CLI to drive a running editor;
  keep worktree comments current.
---

# OCC CLI
`)

    expect(summary).toEqual({
      name: 'occ-cli',
      description: 'Use the occ CLI to drive a running editor; keep worktree comments current.'
    })
  })
})

it.each(['', '\uFEFF'])('preserves the last CRLF frontmatter field with BOM %j', (bom) => {
  for (const fields of [
    ['name: actual-name', 'description: actual description'],
    ['description: actual description', 'name: actual-name']
  ]) {
    const markdown = `${bom}${['---', ...fields, '---', '# Fallback heading', '', 'Fallback paragraph'].join('\r\n')}`
    expect(summarizeSkillMarkdown(markdown)).toEqual({
      name: 'actual-name',
      description: 'actual description'
    })
  }
})
