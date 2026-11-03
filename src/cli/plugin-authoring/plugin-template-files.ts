/** File helpers shared by the `occ plugin create` templates. */

import { localPluginPublisher } from '../../shared/plugins/installation/plugin-publisher-derivation'
import { PLUGIN_DERIVED_PUBLISHER_SINCE } from '../../shared/plugins/manifest/plugin-schema-field-docs'

/** `publisher` is deprecated: set only for authors who still support OCC that requires it. */
export type PluginTemplateInput = { publisher?: string; id: string; name: string }

export type PluginTemplate = {
  description: string
  /** Manifest-relative path (always `/`) to file text. */
  files: Record<string, string>
}

/** Every template targets the release that reads publisher-less manifests and TSX entries. */
const ENGINE = `>=${PLUGIN_DERIVED_PUBLISHER_SINCE}`

export function pluginTemplateKey(input: PluginTemplateInput): string {
  return `${localPluginPublisher(input.publisher)}.${input.id}`
}

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** `engine`: a newer `engines.occ` floor, for templates that use newer fields. */
export function manifest(
  input: PluginTemplateInput,
  description: string,
  fields: Record<string, unknown>,
  engine = ENGINE
): string {
  return json({
    manifestVersion: 2,
    id: input.id,
    ...(input.publisher ? { publisher: input.publisher } : {}),
    name: input.name,
    version: '0.1.0',
    description,
    engines: { occ: engine },
    ...fields
  })
}

export function readme(input: PluginTemplateInput, body: string): string {
  return `# ${input.name}

${body}

## Develop

\`\`\`sh
occ plugin validate .
occ plugin dev watch .    # loads this folder into OCC and prints its logs and reloads; Ctrl-C unloads it
\`\`\`

OCC names the publisher after where the plugin is installed from: the GitHub or GitLab owner of
its repository, or \`local\` for a folder. See
https://github.com/stablyai/occ/blob/main/docs/reference/plugin-authoring.md.
`
}

// Why -text: Git must not rewrite line endings, or the content hash differs per checkout.
// `.occ/` holds the typings `occ plugin types` writes; they are regenerated, never committed.
export const COMMON_FILES = {
  '.gitattributes': '* -text\n',
  '.gitignore': 'node_modules/\n.occ/\n'
}
