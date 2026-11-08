import { readFileSync } from 'node:fs'
import { test, expect } from './helpers/occ-app'
import {
  cleanupMarkdownFixture,
  closeActiveEditorTab,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-editor-fixture'
import {
  expectEditableNestedToggles,
  expectFileKeepsNesting,
  expectPassthroughFallback,
  expectSentinelInsideNestedToggle,
  NESTED_TOGGLE_FIXTURE_DIRECTORY,
  NESTED_TOGGLE_MARKDOWN,
  placeCaretInNestedToggleBody,
  UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
} from './helpers/markdown-nested-toggle'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.describe('Markdown nested toggle regression', () => {
  test.beforeEach(async ({ occPage }) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
  })

  test('editing a nested toggle survives save and reopen', async ({ occPage }, testInfo) => {
    const context = await getActiveWorktreeContext(occPage)
    const sentinel = `editedInsideNestedToggle${Date.now()}`
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-edit',
        testInfo.workerIndex,
        NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(occPage, context, filePath)
      await waitForRichMarkdownEditor(occPage)
      await expectEditableNestedToggles(occPage)

      await placeCaretInNestedToggleBody(occPage)
      await occPage.keyboard.type(` ${sentinel}`)
      await expectSentinelInsideNestedToggle(occPage, sentinel)

      // Save through the real shortcut and assert the bytes that landed on disk.
      await occPage.keyboard.press('ControlOrMeta+S')
      const savedPath = filePath
      await expect
        .poll(() => readFileSync(savedPath, 'utf8'), { timeout: 10_000 })
        .toContain(sentinel)
      expectFileKeepsNesting(readFileSync(savedPath, 'utf8'), sentinel)

      // Reopen the saved bytes from scratch; the reported bug appeared only after reparsing.
      await closeActiveEditorTab(occPage, savedPath)
      await openMarkdownFixture(occPage, context, savedPath)
      await waitForRichMarkdownEditor(occPage)
      await expectEditableNestedToggles(occPage)
      await expectSentinelInsideNestedToggle(occPage, sentinel)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('a nested toggle that cannot be represented stays raw passthrough', async ({
    occPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(occPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-unsupported',
        testInfo.workerIndex,
        UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(occPage, context, filePath)
      await waitForRichMarkdownEditor(occPage)

      await expectPassthroughFallback(occPage)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
