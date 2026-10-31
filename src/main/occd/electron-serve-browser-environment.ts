/** Strip occd-owned user-data and browser overrides from the helper environment. */
export function electronServeEnvironment(userDataPath: string): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  for (const key of [
    'OCC_E2E_USER_DATA_DIR',
    'OCC_USER_DATA',
    'OCC_USER_DATA_PATH',
    'AGENT_BROWSER_ARGS',
    'AGENT_BROWSER_AUTO_CONNECT',
    'AGENT_BROWSER_CDP',
    'AGENT_BROWSER_ENGINE',
    'AGENT_BROWSER_EXECUTABLE_PATH',
    'AGENT_BROWSER_HEADED',
    'AGENT_BROWSER_PROFILE',
    'AGENT_BROWSER_PROVIDER',
    'AGENT_BROWSER_SESSION',
    'AGENT_BROWSER_SESSION_NAME',
    'AGENT_BROWSER_STATE'
  ]) {
    delete environment[key]
  }
  // Keep Electron's native home override active in isolated sidecars.
  if (process.env.OCC_E2E_USER_DATA_DIR || process.env.OCC_E2E_HOME_DIR) {
    environment.OCC_E2E_USER_DATA_DIR = userDataPath
  }
  // Older installed apps hide without forwarding opens if given OCC_BACKGROUND_LAUNCH.
  environment.OCC_OCCD_SIDECAR = '1'
  return environment
}
