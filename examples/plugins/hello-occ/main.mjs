// Sample plugin runs in a lazily forked plain-Node worker; its default export receives commands, events and capability-gated host API.
export default function activate(occ) {
  occ.commands.register('hello-ping', async () => {
    const stored = await occ.host.call('storage.get', { key: 'pings' })
    const count = (typeof stored?.value === 'number' ? stored.value : 0) + 1
    await occ.host.call('storage.set', { key: 'pings', value: count })
    // A string result is shown as-is in OCC; objects are shown as JSON.
    return count === 1 ? 'Pong! First ping.' : `Pong! ${count} pings so far.`
  })

  occ.events.on('workspace.created', async (payload) => {
    occ.log(`${payload.kind} created: ${payload.workspaceId} at ${payload.path}`)
    await occ.host.call('notifications.show', {
      title: 'Workspace created',
      body: payload.path
    })
  })

  occ.events.on('agent.status.changed', (payload) => {
    occ.log(`agent status: ${payload.state} in ${payload.workspaceId ?? 'unknown workspace'}`)
  })
}
