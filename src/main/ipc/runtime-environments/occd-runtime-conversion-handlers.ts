import { ipcMain } from 'electron'
import type {
  OCCdManagedConversionResult,
  OCCdManagedPendingMigrationRow
} from '../../../shared/occd-managed-runtime'
import { listPendingManagedOCCdMigrations } from '../../managed-server/lifecycle/occd-managed-migration-status'
import { convertSshTargetToManagedOCCd } from '../../managed-server/lifecycle/occd-runtime-conversion'
import { conversionCollaborators } from '../../managed-server/lifecycle/occd-runtime-conversion-wiring'
import { requiredString } from './occd-runtime-lifecycle-handlers'

export function registerOCCdRuntimeConversionHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:convertSshHostToManagedOCCd',
    (
      _event,
      args: { sshTargetId: string; name: string }
    ): Promise<OCCdManagedConversionResult> => {
      return convertSshTargetToManagedOCCd(getUserDataPath(), {
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        name: requiredString(args?.name, 'Server name'),
        ...conversionCollaborators()
      })
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:listPendingOCCdMigrations',
    (): OCCdManagedPendingMigrationRow[] => listPendingManagedOCCdMigrations(getUserDataPath())
  )
}
