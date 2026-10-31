// Change only template build identity to model an app update bundling a newer occd.
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  OCCD_TEMPLATE_MANIFEST_FILENAME,
  OCCD_VERSION
} from '../../../src/shared/occd-artifacts'

const ENTRY = 'occd.js'

/** Rewrites `templateDir` in place; its manifest keeps verifying. */
export function makeOCCdTemplateVariant(templateDir: string, tag: string): void {
  const entry = path.join(templateDir, ENTRY)
  appendFileSync(entry, `\n// occd e2e template variant ${tag}\n`)
  const manifestPath = path.join(templateDir, OCCD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.commonSha256[ENTRY] = createHash('sha256').update(readFileSync(entry)).digest('hex')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** The host's activation record, read the way a client reads it. */
export function readHostOCCdActivation(exec: (command: string) => string): {
  active?: string
  previous?: string
  activeAppVersion?: string
} {
  return JSON.parse(exec('cat "$HOME/.occ-remote/occd-active.json"'))
}

export function isOCCdFullVersion(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${OCCD_VERSION}+`)
}
