import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

function errorText(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).toLowerCase()
}

export function pluginInstallErrorMessage(cause: unknown): string {
  const detail = errorText(cause)
  if (detail.includes('occ-plugin.json') && /(missing|unreadable|no )/.test(detail)) {
    return translate(
      'auto.components.settings.pluginError.installManifestMissing',
      "No readable occ-plugin.json was found. Choose the plugin's root folder."
    )
  }
  if (detail.includes('invalid manifest')) {
    return translate(
      'auto.components.settings.pluginError.installManifestInvalid',
      'occ-plugin.json is invalid. Ask the plugin author to fix the manifest.'
    )
  }
  if (detail.includes('requires occ')) {
    return translate(
      'auto.components.settings.pluginError.incompatible',
      'This plugin requires a different OCC version.'
    )
  }
  if (/(symlink|outside|absolute|path traversal|drive prefix)/.test(detail)) {
    return translate(
      'auto.components.settings.pluginError.installUnsafePath',
      'The plugin contains an unsafe file path or symlink and was not installed.'
    )
  }
  if (/(exceeds|too many)/.test(detail)) {
    return translate(
      'auto.components.settings.pluginError.installLimit',
      "The plugin exceeds OCC's install size or file-count limits."
    )
  }
  if (detail.includes('moved after it was checked')) {
    return translate(
      'auto.components.settings.pluginError.installGitMoved',
      'The repository changed after OCC checked it. Try again.'
    )
  }
  // Why: a fork of an official template keeps its reserved id/publisher, and this refusal used to
  // fall through to a generic failure with no hint to rename (#12598). Checked before the Git
  // heuristic because a reserved key such as `github.x` contains "git".
  if (detail.includes('reserved for official occ plugins')) {
    return translate(
      'auto.components.settings.pluginError.installReservedIdentity',
      'This plugin uses a name reserved for official OCC plugins, which install only from OCC’s catalog. For your own copy or fork, change "id" in occ-plugin.json so it doesn’t start with "occ-", and set "publisher" to your own name.'
    )
  }
  if (/(git|repository|fetch|clone|checkout|remote)/.test(detail)) {
    return translate(
      'auto.components.settings.pluginError.installGit',
      "Couldn't fetch this Git revision. Check the URL, #ref, and access."
    )
  }
  return translate(
    'auto.components.settings.PluginInstallDialog.installFailed',
    'Plugin installation failed. Check the source and try again.'
  )
}

/** `installed`: a copy OCC installed, so its user can't edit the manifest; dev folders can. */
export function invalidPluginErrorMessage(
  detailValue: string,
  installed = false,
  t: Translate = translate
): string {
  const detail = detailValue.toLowerCase()
  // Why everything but a version gap: the user of an installed copy can't fix its files.
  if (installed && !detail.includes('requires occ')) {
    return t(
      'auto.components.settings.pluginError.installedManifestUnloadable',
      "This version can't load in this OCC. Update or reinstall it."
    )
  }
  if (detail.includes('missing occ-plugin.json')) {
    return t(
      'auto.components.settings.pluginError.invalidManifestMissing',
      'The plugin root is missing occ-plugin.json. Add it, then refresh plugins.'
    )
  }
  if (detail.includes('invalid manifest')) {
    return t(
      'auto.components.settings.pluginError.invalidManifest',
      'occ-plugin.json is invalid. Fix it, then refresh plugins.'
    )
  }
  if (detail.includes('artifact')) {
    return t(
      'auto.components.settings.pluginError.invalidArtifact',
      'A worker or panel file is missing or unsafe. Fix it, then refresh.'
    )
  }
  if (detail.includes('requires occ')) {
    return t(
      'auto.components.settings.pluginError.incompatible',
      'This plugin requires a different OCC version.'
    )
  }
  return t(
    'auto.components.settings.PluginSettingsRow.invalidPluginError',
    "This plugin's files are invalid. Fix them, then refresh."
  )
}

export function pluginConsentErrorMessage(cause: unknown): string {
  const detail = errorText(cause)
  if (/(changed|fingerprint|current|stale|review)/.test(detail)) {
    return translate(
      'auto.components.settings.pluginError.consentChanged',
      'This plugin changed while you were reviewing it. Review it again.'
    )
  }
  return translate(
    'auto.components.settings.PluginConsentDialog.decisionFailed',
    'Could not save the permission decision. Try again.'
  )
}
