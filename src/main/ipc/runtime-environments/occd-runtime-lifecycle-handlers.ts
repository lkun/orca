import { ipcMain } from 'electron'
import type { OCCdManagedRuntimeStatus } from '../../../shared/occd-managed-runtime'
import { createManagedOCCdEnvironment } from '../../managed-server/lifecycle/occd-runtime-deployment'
import { getManagedOCCdRuntimeStatus } from '../../managed-server/lifecycle/occd-runtime-status'

export function registerOCCdRuntimeLifecycleHandlers(options: {
  getUserDataPath: () => string
}): void {
  ipcMain.handle(
    'runtimeEnvironments:deployOCCd',
    async (_event, args: { name: string; sshTargetId: string; force?: boolean }) =>
      createManagedOCCdEnvironment(options.getUserDataPath(), {
        name: requiredString(args?.name, 'Server name'),
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        force: args?.force === true
      })
  )
  ipcMain.handle(
    'runtimeEnvironments:getOCCdStatus',
    (_event, args: { selector: string }): Promise<OCCdManagedRuntimeStatus> =>
      getManagedOCCdRuntimeStatus(
        options.getUserDataPath(),
        requiredString(args?.selector, 'Server')
      )
  )
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  return value.trim()
}
