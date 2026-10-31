// Clear structured chat’s inherited orchestration identity so test branches depend on fixture env, not which agent launched runner.
for (const name of ['OCC_AGENT_SESSION_ID', 'OCC_STRUCTURED_SESSION']) {
  delete process.env[name]
}
