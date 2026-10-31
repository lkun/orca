/** File helpers shared by the `occ plugin create` templates. */

export type PluginTemplateInput = { publisher: string; id: string; name: string }

export type PluginTemplate = {
  description: string
  /** Manifest-relative path (always `/`) to file text. */
  files: Record<string, string>
}

export const ENGINE = '>=1.4.245'

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function manifest(
  input: PluginTemplateInput,
  description: string,
  fields: Record<string, unknown>
): string {
  return json({
    manifestVersion: 2,
    id: input.id,
    publisher: input.publisher,
    name: input.name,
    version: '0.1.0',
    description,
    engines: { occ: ENGINE },
    ...fields
  })
}

export function readme(input: PluginTemplateInput, body: string): string {
  return `# ${input.name}

${body}

## Develop

\`\`\`sh
occ plugin validate .
occ plugin dev load .     # loads this folder into the running OCC; edits reload automatically
occ plugin logs ${input.publisher}.${input.id}
occ plugin dev unload .
\`\`\`

Set \`publisher\` to the GitHub or GitLab user or organization that owns the repository before
publishing. See https://github.com/stablyai/occ/blob/main/docs/reference/plugin-authoring.md.
`
}

// Why -text: Git must not rewrite line endings, or the content hash differs per checkout.
export const COMMON_FILES = { '.gitattributes': '* -text\n', '.gitignore': 'node_modules/\n' }
