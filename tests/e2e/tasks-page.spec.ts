import { test, expect } from './helpers/occ-app'
import { waitForSessionReady, waitForActiveWorktree, getStoreState } from './helpers/store'
import { GITHUB_TASK_SEARCH_IDLE_MS } from '../../src/renderer/src/components/use-github-task-search-commit'

// Derive cadence from idle timing so slow keystrokes cannot commit a prefix.
const TASK_SEARCH_TYPING_DELAY_MS = Math.round(GITHUB_TASK_SEARCH_IDLE_MS / 6)
const TASK_SEARCH_SETTLE_MS = GITHUB_TASK_SEARCH_IDLE_MS + 50
// Outlast idle timing, React commit and two store roundtrips instead of assuming a flat 2s.
const TASK_SEARCH_PROBE_TIMEOUT_MS = GITHUB_TASK_SEARCH_IDLE_MS * 6

type RenderedTaskSource = {
  source: string
  active: boolean
}

type TaskSearchRequestProbe = {
  countQueries: string[]
  fetchQueries: string[]
}

const TASK_SOURCE_BY_LABEL: Record<string, string> = {
  GitHub: 'github',
  GitLab: 'gitlab',
  Linear: 'linear',
  Jira: 'jira'
}

async function openTasksPage(page: Parameters<typeof getStoreState>[0]): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    store.getState().openTaskPage()
  })
}

async function getRenderedTaskSources(
  page: Parameters<typeof getStoreState>[0]
): Promise<RenderedTaskSource[]> {
  return page
    .locator('[data-contextual-tour-target="tasks-source-filters"] button')
    .evaluateAll((buttons, sourceByLabel) => {
      return buttons.flatMap((button) => {
        const source =
          button.getAttribute('data-task-source') ??
          sourceByLabel[button.getAttribute('aria-label')?.trim() ?? '']
        if (!source) {
          return []
        }
        const active = button.getAttribute('aria-pressed') === 'true'
        return [{ source, active }]
      })
    }, TASK_SOURCE_BY_LABEL)
}

async function openMockedPaginatedGitHubTasks(
  page: Parameters<typeof getStoreState>[0]
): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const repos = store.getState().repos.map((repo, index) =>
      index === 0
        ? {
            ...repo,
            gitRemoteIdentity: {
              canonicalKey: 'github.com/example/repo',
              remoteName: 'origin',
              remoteUrl: 'https://github.com/example/repo.git'
            }
          }
        : repo
    )
    const makePage = (pageNumber: number) =>
      Array.from({ length: 30 }, (_, index) => ({
        id: `issue-${pageNumber}-${index + 1}`,
        type: 'issue' as const,
        number: pageNumber * 100 + index + 1,
        title: `Issue page ${pageNumber} item ${index + 1}`,
        state: 'open' as const,
        url: `https://github.com/example/repo/issues/${pageNumber * 100 + index + 1}`,
        labels: [],
        updatedAt: new Date(1_700_000_000_000 - index * 1_000).toISOString(),
        author: 'octocat',
        repoId: repos[0]?.id ?? 'repo-1'
      }))

    store.setState({
      repos,
      getCachedWorkItems: () => makePage(1),
      prefetchWorkItems: () => {},
      fetchWorkItemsAcrossRepos: async () => ({
        items: makePage(1),
        failedCount: 0,
        githubUnavailable: false
      }),
      fetchWorkItemsNextPage: async (_repos, _perRepoLimit, _displayLimit, _query, pageNumber) => ({
        items: makePage(pageNumber),
        failedCount: 0,
        errorTypes: []
      }),
      countWorkItemsAcrossRepos: async () => ({ totalCount: 840, totalPages: 28 })
    })
    store.getState().openTaskPage({ taskSource: 'github' })
  })
}

async function openInstrumentedGitHubTasksPage(
  page: Parameters<typeof getStoreState>[0]
): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const activeWorktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((worktree) => worktree.id === state.activeWorktreeId)
    const repo = state.repos.find((candidate) => candidate.id === activeWorktree?.repoId)
    if (!repo || !state.settings) {
      throw new Error('GitHub Tasks probe requires a ready repository and settings')
    }
    const probe: TaskSearchRequestProbe = { countQueries: [], fetchQueries: [] }
    ;(
      window as typeof window & { __taskSearchRequestProbe?: TaskSearchRequestProbe }
    ).__taskSearchRequestProbe = probe
    const existingIssue = {
      id: 'issue:999',
      type: 'issue' as const,
      number: 999,
      title: 'Existing GitHub issue',
      state: 'open' as const,
      url: 'https://github.com/occ/e2e/issues/999',
      labels: [],
      updatedAt: '2026-08-08T00:00:00Z',
      author: 'occ-e2e',
      repoId: repo.id,
      assignees: [],
      reviewRequests: []
    }

    store.setState({
      repos: state.repos.map((candidate) =>
        candidate.id === repo.id
          ? { ...candidate, upstream: { owner: 'occ', repo: 'e2e' } }
          : candidate
      ),
      settings: {
        ...state.settings,
        defaultTaskSource: 'github',
        defaultTaskViewPreset: 'issues',
        visibleTaskProviders: ['github']
      },
      taskResumeState: {
        ...state.taskResumeState,
        githubItemsPreset: 'issues',
        githubItemsQuery: 'is:issue is:open',
        githubMode: 'items'
      },
      prefetchWorkItems: () => undefined,
      fetchWorkItemsAcrossRepos: async (_repos, _perRepoLimit, _displayLimit, query) => {
        probe.fetchQueries.push(query)
        return { items: [existingIssue], failedCount: 0, githubUnavailable: false }
      },
      countWorkItemsAcrossRepos: async (_repos, query) => {
        probe.countQueries.push(query)
        return { totalCount: 1, totalPages: 1 }
      }
    })
    store
      .getState()
      .openTaskPage(
        { taskSource: 'github', preselectedRepoId: repo.id },
        { recordTasksInteraction: false }
      )
  })
}

async function readTaskSearchRequestProbe(
  page: Parameters<typeof getStoreState>[0]
): Promise<TaskSearchRequestProbe> {
  return page.evaluate(() => {
    const probe = (window as typeof window & { __taskSearchRequestProbe?: TaskSearchRequestProbe })
      .__taskSearchRequestProbe
    if (!probe) {
      throw new Error('Task search request probe is not installed')
    }
    return { countQueries: [...probe.countQueries], fetchQueries: [...probe.fetchQueries] }
  })
}

async function resetTaskSearchRequestProbe(
  page: Parameters<typeof getStoreState>[0]
): Promise<void> {
  await page.evaluate(() => {
    const probe = (window as typeof window & { __taskSearchRequestProbe?: TaskSearchRequestProbe })
      .__taskSearchRequestProbe
    if (!probe) {
      throw new Error('Task search request probe is not installed')
    }
    probe.countQueries.length = 0
    probe.fetchQueries.length = 0
  })
}

test.describe('Tasks page', () => {
  test.beforeEach(async ({ occPage }) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
  })

  test('opening the tasks view renders the tasks UI', async ({ occPage }) => {
    await openTasksPage(occPage)

    await expect
      .poll(async () => getStoreState<string>(occPage, 'activeView'), { timeout: 5_000 })
      .toBe('tasks')

    await expect(occPage.getByRole('button', { name: 'Close tasks' })).toBeVisible({
      timeout: 10_000
    })

    // Assert stable Tasks chrome because source tabs depend on provider availability.
    let renderedSources: RenderedTaskSource[] = []
    await expect
      .poll(
        async () => {
          renderedSources = await getRenderedTaskSources(occPage)
          return renderedSources.length
        },
        {
          timeout: 10_000,
          message: 'Tasks source controls did not render'
        }
      )
      .toBeGreaterThan(1)

    await expect
      .poll(
        async () => {
          renderedSources = await getRenderedTaskSources(occPage)
          return renderedSources.some((source) => source.active)
        },
        {
          timeout: 5_000,
          message: 'Active task source did not render'
        }
      )
      .toBe(true)
    if (renderedSources.some((source) => source.source === 'github' && source.active)) {
      await expect(occPage.getByRole('button', { name: 'Issues', exact: true })).toBeVisible()
      await expect(occPage.getByRole('button', { name: 'PRs', exact: true })).toBeVisible()
      await expect(occPage.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
      await expect(occPage.getByPlaceholder(/Search GitHub (issues|PRs)/i)).toBeVisible()
    }
  })

  test('closing the tasks page returns to the previous view', async ({ occPage }) => {
    const previousView = await getStoreState<string>(occPage, 'activeView')

    await openTasksPage(occPage)
    await expect
      .poll(async () => getStoreState<string>(occPage, 'activeView'), { timeout: 5_000 })
      .toBe('tasks')
    await expect(occPage.getByRole('button', { name: 'Close tasks' })).toBeVisible()

    await occPage.getByRole('button', { name: 'Close tasks' }).click()

    await expect
      .poll(async () => getStoreState<string>(occPage, 'activeView'), { timeout: 5_000 })
      .toBe(previousView)
    // Require prior-view DOM to remount plus Tasks close control to disappear; activeView alone misses broken rendering.
    await expect(occPage.getByRole('button', { name: 'Close tasks' })).toHaveCount(0)
    if (previousView === 'terminal') {
      await expect(occPage.locator('.xterm').first()).toBeVisible({ timeout: 5_000 })
    }
  })

  test('reopening restores the GitHub page and scroll position', async ({ occPage }) => {
    await openMockedPaginatedGitHubTasks(occPage)

    await occPage.getByRole('button', { name: 'Page 28', exact: true }).click()
    await expect(occPage.getByText('Issue page 28 item 1', { exact: true })).toBeVisible()

    const list = occPage.locator('[data-task-list-scroll="github"]')
    await list.evaluate((element) => {
      element.scrollTop = 360
      element.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(300)

    await occPage.getByRole('button', { name: 'Close tasks' }).click()
    await expect(list).toHaveCount(0)
    const clampedRowsStyle = await occPage.addStyleTag({
      content:
        '[data-task-list-scroll="github"] > .divide-y { max-height: 0 !important; overflow: hidden !important; }'
    })
    await openTasksPage(occPage)

    await expect(occPage.getByRole('button', { name: 'Page 28', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    const restoredList = occPage.locator('[data-task-list-scroll="github"]')
    await expect.poll(() => restoredList.evaluate((element) => element.scrollTop)).toBe(0)
    await clampedRowsStyle.evaluate((element) => {
      element.parentNode?.removeChild(element)
    })
    await expect(occPage.getByText('Issue page 28 item 1', { exact: true })).toBeVisible()
    await expect
      .poll(() => restoredList.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(300)

    await occPage.getByText('Issue page 28 item 12', { exact: true }).click()
    await expect(restoredList).toHaveCount(0)
    await expect
      .poll(async () => {
        const position = await getStoreState<{ scrollTop: number }>(occPage, 'taskListPosition')
        return position.scrollTop
      })
      .toBeGreaterThan(300)
    await occPage.getByRole('button', { name: 'GitHub list', exact: true }).click()
    await expect(occPage.getByText('Issue page 28 item 1', { exact: true })).toBeVisible()
    await expect
      .poll(() => restoredList.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(300)

    await occPage.getByRole('button', { name: 'Close tasks' }).click()
    const pendingRestoreStyle = await occPage.addStyleTag({
      content:
        '[data-task-list-scroll="github"] > .divide-y { max-height: 0 !important; overflow: hidden !important; }'
    })
    await openTasksPage(occPage)
    await expect(occPage.getByRole('button', { name: 'Page 28', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await occPage.getByRole('button', { name: 'Page 1', exact: true }).click()
    await pendingRestoreStyle.evaluate((element) => {
      element.parentNode?.removeChild(element)
    })
    await expect(occPage.getByRole('button', { name: 'Page 1', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect
      .poll(() =>
        occPage
          .locator('[data-task-list-scroll="github"]')
          .evaluate((element) => element.scrollTop)
      )
      .toBe(0)

    await occPage.getByRole('button', { name: 'Page 28', exact: true }).click()
    await expect(occPage.getByText('Issue page 28 item 1', { exact: true })).toBeVisible()
    await restoredList.evaluate((element) => {
      element.scrollTop = 360
      element.dispatchEvent(new Event('scroll'))
    })
    await expect
      .poll(() => restoredList.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(300)
    await occPage.getByRole('button', { name: 'Close tasks' }).click()

    const permanentlyClampedRowsStyle = await occPage.addStyleTag({
      content:
        '[data-task-list-scroll="github"] > .divide-y { max-height: 0 !important; overflow: hidden !important; }'
    })
    await openTasksPage(occPage)
    await expect(occPage.getByRole('button', { name: 'Page 28', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    // Outlast the old 5s restore give-up so an unpainted list cannot overwrite remembered scroll with zero.
    await occPage.waitForTimeout(5_500)
    await occPage.getByRole('button', { name: 'Close tasks' }).click()
    await expect
      .poll(async () => {
        const position = await getStoreState<{ scrollTop: number }>(occPage, 'taskListPosition')
        return position.scrollTop
      })
      .toBeGreaterThan(300)
    await permanentlyClampedRowsStyle.evaluate((element) => {
      element.parentNode?.removeChild(element)
    })
  })

  test('GitHub search waits for idle, keeps rows visible, and Enter does not double-fetch', async ({
    occPage
  }) => {
    await openInstrumentedGitHubTasksPage(occPage)

    const input = occPage.getByPlaceholder('Search GitHub issues...')
    const existingIssue = occPage.getByText('Existing GitHub issue', { exact: true })
    await expect(input).toBeVisible()
    await expect(existingIssue).toBeVisible()

    await input.fill('')
    await expect
      .poll(async () => readTaskSearchRequestProbe(occPage), {
        timeout: TASK_SEARCH_PROBE_TIMEOUT_MS
      })
      .toEqual({ countQueries: ['is:issue is:open'], fetchQueries: ['is:issue is:open'] })
    await resetTaskSearchRequestProbe(occPage)

    await input.pressSequentially('rate', { delay: TASK_SEARCH_TYPING_DELAY_MS })

    await expect(existingIssue).toBeVisible()

    // Require one final-value request per surface, never a typed prefix.
    await expect
      .poll(async () => readTaskSearchRequestProbe(occPage), {
        timeout: TASK_SEARCH_PROBE_TIMEOUT_MS
      })
      .toEqual({ countQueries: ['is:issue rate'], fetchQueries: ['is:issue rate'] })

    await resetTaskSearchRequestProbe(occPage)
    await input.pressSequentially('x')
    await input.press('Enter')

    await expect
      .poll(async () => readTaskSearchRequestProbe(occPage), {
        timeout: TASK_SEARCH_PROBE_TIMEOUT_MS
      })
      .toEqual({ countQueries: ['is:issue ratex'], fetchQueries: ['is:issue ratex'] })
    await occPage.waitForTimeout(TASK_SEARCH_SETTLE_MS)
    expect(await readTaskSearchRequestProbe(occPage)).toEqual({
      countQueries: ['is:issue ratex'],
      fetchQueries: ['is:issue ratex']
    })
    await expect(input).toHaveValue('is:issue ratex')
    await expect(existingIssue).toBeVisible()
  })
})
