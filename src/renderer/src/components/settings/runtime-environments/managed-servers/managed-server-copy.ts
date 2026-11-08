import type {
  OCCdManagedPendingMigrationRow,
  OCCdManagedRuntimeStatus
} from '../../../../../../shared/occd-managed-runtime'
import type { OCCdMigrationBlocker } from '../../../../../../shared/occd-migration/occd-migration-preflight'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import { OCCD_UPDATE_WSL_MOVE_RUNNING_CODE } from '../../../../../../shared/wsl-host-types'
import { dependencyKindLabel } from './managed-server-dependency-kinds'

export function migrationPhaseLabel(
  phase: OCCdManagedPendingMigrationRow['phase'],
  t: Translate = translate
): string {
  switch (phase) {
    case 'source-fenced':
      return t('auto.components.settings.managedServers.phase.fenced', 'Host locked')
    case 'destination-staged':
      return t('auto.components.settings.managedServers.phase.staged', 'Copy staged')
    case 'destination-committed':
      return t('auto.components.settings.managedServers.phase.committed', 'Copy committed')
    case 'source-retired':
      return t('auto.components.settings.managedServers.phase.retired', 'Finished')
  }
}

export function recoveryLabel(
  recovery: NonNullable<OCCdManagedRuntimeStatus['recovery']>,
  t: Translate = translate
): string {
  switch (recovery.operation) {
    case 'activate':
      return t(
        'auto.components.settings.managedServers.recovery.activate',
        'An update was interrupted'
      )
    case 'rollback':
      return t(
        'auto.components.settings.managedServers.recovery.rollback',
        'A rollback was interrupted'
      )
    case 'decommission':
      return t(
        'auto.components.settings.managedServers.recovery.decommission',
        'A stop was interrupted'
      )
  }
}

/** `null` counts are unknown, never zero: the server did not answer. */
export function terminalCensusLabel(
  terminals: OCCdManagedRuntimeStatus['terminals'],
  t: Translate = translate
): string {
  if (terminals.liveSessions === null) {
    return t(
      'auto.components.settings.managedServers.terminals.unknown',
      'Running terminals: unknown'
    )
  }
  return t(
    'auto.components.settings.managedServers.terminals.count',
    'Running terminals: {{count}}',
    { count: terminals.liveSessions }
  )
}

/** Copy for Update anyway; it states only what the forced update was verified to keep. */
export function forceUpdateMessage(t: Translate = translate): string {
  return t(
    'auto.components.settings.managedServers.row.forceUpdate',
    'Terminals are running on this host. They keep running through the update, and their panes reconnect when OCC’s server restarts.'
  )
}

export function conversionBlockerLabel(blocker: OCCdMigrationBlocker): string {
  switch (blocker.code) {
    case 'occd_migration_target_not_found':
      return translate(
        'auto.components.settings.managedServers.blocker.notFound',
        'The SSH host is gone.'
      )
    case 'occd_migration_target_owned':
    case 'occd_migration_owner_unrecorded':
      return translate(
        'auto.components.settings.managedServers.blocker.owned',
        'OCC already runs on this SSH host.'
      )
    case 'occd_migration_direct_ssh_repositories':
    case 'occd_migration_direct_ssh_folder_workspaces':
      return translate(
        'auto.components.settings.managedServers.blocker.catalog',
        'Projects on this host cannot move yet.'
      )
    case 'occd_migration_direct_ssh_terminal_leases':
      return translate(
        'auto.components.settings.managedServers.blocker.terminals',
        'Terminals on this host are still running ({{count}}). Close them first.',
        { count: blocker.terminalLeases.length }
      )
    case 'occd_migration_saved_port_forwards':
      return translate(
        'auto.components.settings.managedServers.blocker.portForwards',
        'Saved port forwards stay with the SSH host.'
      )
    case 'occd_migration_dependent_state':
      return translate(
        'auto.components.settings.managedServers.blocker.dependents',
        'State that cannot move yet: {{kinds}}.',
        {
          kinds: blocker.dependencies
            .map((dependency) => `${dependencyKindLabel(dependency.kind)} (${dependency.count})`)
            .join(', ')
        }
      )
    case 'occd_migration_dependency_unverifiable':
      return translate(
        'auto.components.settings.managedServers.blocker.unverifiable',
        'OCC could not read its saved {{sources}}, so it cannot tell what would move.',
        { sources: blocker.sources.map(dependencyKindLabel).join(', ') }
      )
  }
}

// Main's refusal codes, grouped by what the user does next; its English `reason` never reaches UI.
const LIVE_TERMINAL_CODES = new Set([
  'occd_initial_runtime_live',
  'occd_update_strands_live_terminals',
  'occd_update_terminals_running',
  'occd_update_ends_in_process_terminals',
  'occd_rollback_orphans_live_terminals',
  'occd_rollback_strands_live_terminals',
  'occd_recovery_orphans_live_terminals',
  'occd_stop_still_running'
])
const UNVERIFIABLE_CODES = new Set([
  'occd_initial_runtime_unverifiable',
  'occd_update_terminal_census_unavailable',
  'occd_update_daemon_protocol_unverifiable',
  'occd_rollback_active_identity_unverifiable',
  'occd_rollback_census_unavailable',
  'occd_rollback_daemon_protocol_unverifiable',
  'occd_rollback_snapshot_unverifiable',
  'occd_recovery_census_required',
  'occd_recovery_unverifiable',
  'occd_stop_cancel_unverifiable'
])
const MIGRATION_CODES = new Set([
  'occd_rollback_migration_in_progress',
  'occd_rollback_crosses_migration'
])

export function managedServerOutcomeLabel(
  result: {
    outcome: string
    code?: string
    verdict?: string
  },
  t: Translate = translate
): string {
  const code = result.code ?? ''
  if (code === 'occd_stop_active_environment') {
    return t(
      'auto.components.settings.managedServers.outcome.defaultServer',
      'Not done: this server is the default host for new projects. Choose another one under New projects open on before stopping it.'
    )
  }
  if (result.verdict === 'live' || LIVE_TERMINAL_CODES.has(code)) {
    return t(
      'auto.components.settings.managedServers.outcome.live',
      'Not done: terminals on this server are still running. Close them and try again.'
    )
  }
  if (result.verdict === 'unverifiable' || UNVERIFIABLE_CODES.has(code)) {
    return t(
      'auto.components.settings.managedServers.outcome.unverifiable',
      'Not done: OCC couldn’t confirm what is running on this server. Try again when the host is reachable.'
    )
  }
  if (code === OCCD_UPDATE_WSL_MOVE_RUNNING_CODE) {
    return t(
      'auto.components.settings.managedServers.outcome.wslMoveRunning',
      'Not done: a project is moving onto this server. OCC updates it once the move finishes.'
    )
  }
  if (MIGRATION_CODES.has(code)) {
    return t(
      'auto.components.settings.managedServers.outcome.migration',
      'Not done: a move onto this server is unfinished. Resume it first.'
    )
  }
  if (result.outcome === 'deferred' || result.outcome === 'pending') {
    return t(
      'auto.components.settings.managedServers.outcome.deferred',
      'Not done yet: the server isn’t ready for this. Try again later.'
    )
  }
  return t(
    'auto.components.settings.managedServers.outcome.failed',
    'OCC couldn’t finish this on the server. Try again.'
  )
}
