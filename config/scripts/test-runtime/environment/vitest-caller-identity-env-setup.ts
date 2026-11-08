// Clear the launching terminal’s inherited OCC identity so test branches depend on fixture env, not which agent launched runner.
for (const name of [
  'OCC_AGENT_SESSION_ID',
  'OCC_STRUCTURED_SESSION',
  'OCC_WORKTREE_ID',
  'OCC_WORKSPACE_ID',
  'OCC_RUNTIME_SOURCE_ID',
  'OCC_RUNTIME_SOURCE_INCARNATION',
  'OCC_RUNTIME_SOURCE_PROFILE_PATH'
]) {
  delete process.env[name]
}
