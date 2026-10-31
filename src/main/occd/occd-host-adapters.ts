import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { OCCD_CLI_PACKAGE_FILENAME } from '../../shared/occd-artifacts'
import { setAppEnvironment, type AppEnvironment } from '../../shared/app-environment'
import { setSecretStore } from '../../shared/secret-store'
import { resolveOCCdInstallRoot, resolveOCCdPath } from './occd-app-paths'
import { getOCCdCliLauncherPath } from './occd-cli-launcher'
import { createOCCdSecretStore, type OCCdSecretStore } from './occd-secret-store'
import { setSpeechServiceFactories } from '../speech/speech-runtime-service'
import { occdSpeechServiceFactories } from './occd-speech-services'

let quitRegisteredHandlers = (): void => {}

export function runOCCdQuitHandlers(): void {
  quitRegisteredHandlers()
}

function createNodeAppEnvironment(): AppEnvironment {
  const quitHandlers: (() => void)[] = []
  // Synchronous quit handlers must not preempt the signal handler’s awaited runtime/browser teardown.
  quitRegisteredHandlers = (): void => {
    const errors: unknown[] = []
    for (const handler of quitHandlers.splice(0)) {
      try {
        handler()
      } catch (error) {
        errors.push(error)
      }
    }
    // Failed handlers may leave writers running and keep the instance lock held.
    if (errors.length > 0) {
      throw new AggregateError(errors, 'occd_quit_handlers_failed')
    }
  }
  return {
    getPath: resolveOCCdPath,
    getAppPath: () => resolveOCCdInstallRoot(),
    getVersion: () => process.env.OCC_VERSION ?? '0.0.0-occd',
    // Packaged gates production HTTPS/CLI/PATH policy; layout callers must inspect asar separately.
    isPackaged: () => true,
    getCliLauncherPath: getOCCdCliLauncherPath,
    onWillQuit: (handler) => quitHandlers.push(handler),
    exit: (code = 0) => process.exit(code),
    getAppMetrics: () => []
  }
}

let occdSecretStore: OCCdSecretStore | null = null

export async function prepareOCCdSecretStore(
  keyDir: string,
  userDataPath: string
): Promise<boolean> {
  if (!occdSecretStore) {
    throw new Error('occd_secret_store_not_installed — call installOCCdHostAdapters() first')
  }
  return occdSecretStore.prepare({ keyDir, userDataPath })
}

/** Stamp the bundle’s own release so inherited desktop versions cannot misidentify this server. */
export function stampOCCdAppVersion(installRoot: () => string = resolveOCCdInstallRoot): void {
  let version: unknown
  try {
    const path = join(installRoot(), ...OCCD_CLI_PACKAGE_FILENAME.split('/'))
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    version = parsed && typeof parsed === 'object' && 'version' in parsed ? parsed.version : null
  } catch {
    return
  }
  if (typeof version === 'string' && version.length > 0) {
    process.env.OCC_APP_VERSION = version
  }
}

export function installOCCdHostAdapters(): void {
  stampOCCdAppVersion()
  setAppEnvironment(createNodeAppEnvironment())
  occdSecretStore = createOCCdSecretStore()
  setSecretStore(occdSecretStore)
  setSpeechServiceFactories(occdSpeechServiceFactories)
}
