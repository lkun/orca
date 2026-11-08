import { startOCCd } from './occd-entry'
import process from 'node:process'
import { resolveOCCdInstallRoot } from './occd-app-paths'
import { OCCD_USAGE, parseArgs } from './occd-command-arguments'
import { installOCCdShutdownSignals, type OCCdShutdownTrigger } from './occd-lifecycle'
import { installOCCdProcessErrorGuards } from './occd-process-error-guards'
import { installOCCdStopRequestListeners } from './occd-stop-request-listener'
import { prepareOCCdManagedStop } from './occd-managed-stop-admission'
import { bindOCCdIdleShutdown } from './occd-managed-idle-exit-host'

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(OCCD_USAGE)
    return
  }
  let shutdownTrigger: OCCdShutdownTrigger | null = null
  // Fire-and-forget startup work can reject before its first await completes.
  installOCCdProcessErrorGuards(() => shutdownTrigger)
  const startup = startOCCd(options)
  const requestShutdown = installOCCdShutdownSignals(async () => (await startup).stop())
  shutdownTrigger = requestShutdown
  const handle = await startup
  // Stop requests must name the runtime/instance established by startup.
  installOCCdStopRequestListeners(() => requestShutdown('stop request'), {
    installRoot: resolveOCCdInstallRoot(),
    managedStop: handle.managedStop,
    beforeManagedStop: prepareOCCdManagedStop
  })
  bindOCCdIdleShutdown(requestShutdown)
}
