// No `node:module` import here: `occ plugin test` loads this on Node 20.6, which has no registerHooks.

export const isOCCSpecifier = (specifier: string): boolean =>
  specifier === 'occ' || specifier.startsWith('occ/')

/** Why a worker cannot import `occ` at run time; `occ plugin test` says the same. */
export function pluginWorkerOCCImportMessage(specifier: string): string {
  return `cannot import "${specifier}" at run time: it only provides types. Write \`import type { OCCWorkerApi } from 'occ/worker'\` and use the \`occ\` object passed to activate(occ).`
}
