// The plugin's own worker, started by the panel's first `plugin.request`. It answers
// `tasks.suggest` from the `suggestions` setting, and watches the task list the panel keeps in
// storage (`persist: 'storage'`) to post `tasks.allDone`.

/** @param {unknown} todos */
const openCount = (todos) => (Array.isArray(todos) ? todos.filter((todo) => !todo.done).length : 0)

/** @type {import('occ/worker').Activate} */
export default async function activate(occ) {
  // Null until the panel first stores its list, so finishing the starting tasks still counts.
  const stored = await occ.storage.get('todos')
  let open = stored === null ? null : openCount(stored)

  occ.panels.handle('tasks.suggest', async ({ taken }) => {
    const ideas = String((await occ.settings.get('suggestions')) ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if ((await occ.settings.get('suggestionOrder')) === 'reversed') {
      ideas.reverse()
    }
    return { title: ideas.find((idea) => !taken.includes(idea)) ?? null }
  })

  occ.storage.onDidChange(async ({ key }) => {
    if (key !== 'todos') {
      return
    }
    const todos = await occ.storage.get('todos')
    const nowOpen = openCount(todos)
    const count = Array.isArray(todos) ? todos.length : 0
    if (
      open !== 0 &&
      nowOpen === 0 &&
      count > 0 &&
      (await occ.settings.get('celebrate')) !== false
    ) {
      occ.panels.post('tasks.allDone', { count })
    }
    open = nowOpen
  })
}
