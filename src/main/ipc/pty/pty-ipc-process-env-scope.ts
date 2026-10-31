// Split suites rewrite platform and agent-home environment; capture and restore the host values.
export function createPtyIpcProcessEnvScope() {
  const savedOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
  const savedOCCOpenCodeConfigDir = process.env.OCC_OPENCODE_CONFIG_DIR
  const savedOCCOpenCodeSourceConfigDir = process.env.OCC_OPENCODE_SOURCE_CONFIG_DIR
  const savedPiAgentDir = process.env.PI_CODING_AGENT_DIR
  const savedOCCPiAgentDir = process.env.OCC_PI_CODING_AGENT_DIR
  const savedOCCPiSourceAgentDir = process.env.OCC_PI_SOURCE_AGENT_DIR
  const savedOCCCodexHome = process.env.OCC_CODEX_HOME
  const savedOCCOmpAgentDir = process.env.OCC_OMP_CODING_AGENT_DIR
  const savedOCCOmpSourceAgentDir = process.env.OCC_OMP_SOURCE_AGENT_DIR
  const savedOCCOmpStatusExtension = process.env.OCC_OMP_STATUS_EXTENSION
  const savedPrimeAgentDir = process.env.PRIME_AGENT_CODING_AGENT_DIR
  const savedOCCPrimeAgentSourceDir = process.env.OCC_PRIME_AGENT_SOURCE_AGENT_DIR
  const savedOCCPrimeAgentStatusExtension = process.env.OCC_PRIME_AGENT_STATUS_EXTENSION
  const savedOCCClaudeAgentStatusSettings = process.env.OCC_CLAUDE_AGENT_STATUS_SETTINGS
  const savedProcessPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const savedDisableMacosLoginShell = process.env.OCC_DISABLE_MACOS_LOGIN_SHELL
  const savedOCCUserDataPath = process.env.OCC_USER_DATA_PATH

  function applyTestEnvDefaults() {
    // POSIX is the default fixture; Windows cases explicitly opt in.
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin'
    })
    // Disable the TCC argv wrapper except in its dedicated tests.
    process.env.OCC_DISABLE_MACOS_LOGIN_SHELL = '1'
    delete process.env.OPENCODE_CONFIG_DIR
    delete process.env.OCC_OPENCODE_SOURCE_CONFIG_DIR
    delete process.env.OCC_OPENCODE_CONFIG_DIR
    delete process.env.OCC_AGENT_HOOK_ENDPOINT
    delete process.env.OCC_CLAUDE_AGENT_STATUS_SETTINGS
    delete process.env.PI_CODING_AGENT_DIR
    delete process.env.OCC_PI_SOURCE_AGENT_DIR
    delete process.env.OCC_PI_CODING_AGENT_DIR
    delete process.env.OCC_CODEX_HOME
    delete process.env.OCC_OMP_SOURCE_AGENT_DIR
    delete process.env.OCC_OMP_CODING_AGENT_DIR
    delete process.env.OCC_OMP_STATUS_EXTENSION
    delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    delete process.env.OCC_PRIME_AGENT_SOURCE_AGENT_DIR
    delete process.env.OCC_PRIME_AGENT_STATUS_EXTENSION
  }

  function restoreProcessEnv() {
    if (savedProcessPlatform) {
      Object.defineProperty(process, 'platform', savedProcessPlatform)
    }
    if (savedDisableMacosLoginShell !== undefined) {
      process.env.OCC_DISABLE_MACOS_LOGIN_SHELL = savedDisableMacosLoginShell
    } else {
      delete process.env.OCC_DISABLE_MACOS_LOGIN_SHELL
    }
    if (savedOCCUserDataPath !== undefined) {
      process.env.OCC_USER_DATA_PATH = savedOCCUserDataPath
    } else {
      delete process.env.OCC_USER_DATA_PATH
    }
    if (savedOpenCodeConfigDir !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = savedOpenCodeConfigDir
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }
    if (savedOCCOpenCodeConfigDir !== undefined) {
      process.env.OCC_OPENCODE_CONFIG_DIR = savedOCCOpenCodeConfigDir
    } else {
      delete process.env.OCC_OPENCODE_CONFIG_DIR
    }
    if (savedOCCOpenCodeSourceConfigDir !== undefined) {
      process.env.OCC_OPENCODE_SOURCE_CONFIG_DIR = savedOCCOpenCodeSourceConfigDir
    } else {
      delete process.env.OCC_OPENCODE_SOURCE_CONFIG_DIR
    }
    if (savedPiAgentDir !== undefined) {
      process.env.PI_CODING_AGENT_DIR = savedPiAgentDir
    } else {
      delete process.env.PI_CODING_AGENT_DIR
    }
    if (savedOCCPiAgentDir !== undefined) {
      process.env.OCC_PI_CODING_AGENT_DIR = savedOCCPiAgentDir
    } else {
      delete process.env.OCC_PI_CODING_AGENT_DIR
    }
    if (savedOCCPiSourceAgentDir === undefined) {
      delete process.env.OCC_PI_SOURCE_AGENT_DIR
    } else {
      process.env.OCC_PI_SOURCE_AGENT_DIR = savedOCCPiSourceAgentDir
    }
    if (savedOCCCodexHome === undefined) {
      delete process.env.OCC_CODEX_HOME
    } else {
      process.env.OCC_CODEX_HOME = savedOCCCodexHome
    }
    if (savedOCCOmpAgentDir !== undefined) {
      process.env.OCC_OMP_CODING_AGENT_DIR = savedOCCOmpAgentDir
    } else {
      delete process.env.OCC_OMP_CODING_AGENT_DIR
    }
    if (savedOCCOmpSourceAgentDir !== undefined) {
      process.env.OCC_OMP_SOURCE_AGENT_DIR = savedOCCOmpSourceAgentDir
    } else {
      delete process.env.OCC_OMP_SOURCE_AGENT_DIR
    }
    if (savedOCCOmpStatusExtension !== undefined) {
      process.env.OCC_OMP_STATUS_EXTENSION = savedOCCOmpStatusExtension
    } else {
      delete process.env.OCC_OMP_STATUS_EXTENSION
    }
    if (savedPrimeAgentDir !== undefined) {
      process.env.PRIME_AGENT_CODING_AGENT_DIR = savedPrimeAgentDir
    } else {
      delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    }
    if (savedOCCPrimeAgentSourceDir !== undefined) {
      process.env.OCC_PRIME_AGENT_SOURCE_AGENT_DIR = savedOCCPrimeAgentSourceDir
    } else {
      delete process.env.OCC_PRIME_AGENT_SOURCE_AGENT_DIR
    }
    if (savedOCCPrimeAgentStatusExtension !== undefined) {
      process.env.OCC_PRIME_AGENT_STATUS_EXTENSION = savedOCCPrimeAgentStatusExtension
    } else {
      delete process.env.OCC_PRIME_AGENT_STATUS_EXTENSION
    }
    if (savedOCCClaudeAgentStatusSettings === undefined) {
      delete process.env.OCC_CLAUDE_AGENT_STATUS_SETTINGS
    } else {
      process.env.OCC_CLAUDE_AGENT_STATUS_SETTINGS = savedOCCClaudeAgentStatusSettings
    }
  }

  return { applyTestEnvDefaults, restoreProcessEnv }
}
