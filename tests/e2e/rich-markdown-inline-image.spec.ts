import { test, expect } from './helpers/occ-app'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-editor-fixture'
import {
  collectRichMarkdownPageErrors,
  expectNoRichMarkdownSchemaCrash,
  INLINE_IMAGE_DETAILS_MARKDOWN,
  INLINE_IMAGE_FIXTURE_DIRECTORY,
  INLINE_IMAGE_PARAGRAPH_MARKDOWN,
  writeInlineImageAsset
} from './helpers/markdown-inline-image'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Nested inline images used to parse invalid schema and fail only when the first edit reassembled their paragraph.
test.describe('Rich markdown inline image regression', () => {
  test.beforeEach(async ({ occPage }) => {
    await waitForSessionReady(occPage)
    await waitForActiveWorktree(occPage)
  })

  test('an inline image inside a paragraph survives a keystroke', async ({
    occPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(occPage)
    const pageErrors = collectRichMarkdownPageErrors(occPage)
    let filePath: string | null = null

    try {
      writeInlineImageAsset(context.rootPath)
      filePath = await createMarkdownFixture(
        context,
        INLINE_IMAGE_FIXTURE_DIRECTORY,
        'paragraph-inline-image',
        testInfo.workerIndex,
        INLINE_IMAGE_PARAGRAPH_MARKDOWN
      )
      await openMarkdownFixture(occPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(occPage)

      const paragraph = editor.locator('p').filter({ hasText: 'more text' }).first()
      await expect(paragraph).toBeVisible({ timeout: 15_000 })
      await expect(editor.locator('img')).toHaveCount(1, { timeout: 15_000 })

      // Type at paragraph start to hit the reported reassembly RangeError.
      await paragraph.click({ position: { x: 12, y: 8 } })
      await occPage.keyboard.press('Home')
      await occPage.keyboard.type('X')

      await expect(editor.locator('p').filter({ hasText: 'XSome text' })).toHaveCount(1)
      await expect(editor.locator('img')).toHaveCount(1)
      await expectNoRichMarkdownSchemaCrash(occPage, pageErrors)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('an inline image inside a toggle summary survives a keystroke', async ({
    occPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(occPage)
    const pageErrors = collectRichMarkdownPageErrors(occPage)
    let filePath: string | null = null

    try {
      writeInlineImageAsset(context.rootPath)
      filePath = await createMarkdownFixture(
        context,
        INLINE_IMAGE_FIXTURE_DIRECTORY,
        'details-inline-image',
        testInfo.workerIndex,
        INLINE_IMAGE_DETAILS_MARKDOWN
      )
      await openMarkdownFixture(occPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(occPage)

      const summary = editor.locator('summary').first()
      await expect(summary).toBeVisible({ timeout: 15_000 })
      await expect(editor.locator('summary img')).toHaveCount(1, { timeout: 15_000 })

      await summary.click()
      await occPage.keyboard.press('End')
      await occPage.keyboard.type('X')

      await expect(editor.locator('summary').filter({ hasText: 'labelX' })).toHaveCount(1)
      await expect(editor.locator('summary img')).toHaveCount(1)
      await expectNoRichMarkdownSchemaCrash(occPage, pageErrors)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('a formatting command over an inline image keeps the image', async ({
    occPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(occPage)
    const pageErrors = collectRichMarkdownPageErrors(occPage)
    let filePath: string | null = null

    try {
      writeInlineImageAsset(context.rootPath)
      filePath = await createMarkdownFixture(
        context,
        INLINE_IMAGE_FIXTURE_DIRECTORY,
        'paragraph-inline-image-bold',
        testInfo.workerIndex,
        INLINE_IMAGE_PARAGRAPH_MARKDOWN
      )
      await openMarkdownFixture(occPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(occPage)

      const paragraph = editor.locator('p').filter({ hasText: 'more text' }).first()
      await expect(paragraph).toBeVisible({ timeout: 15_000 })
      await expect(editor.locator('img')).toHaveCount(1, { timeout: 15_000 })

      // toggleBold reassembles every selected paragraph, which previously dropped the image.
      await paragraph.click({ position: { x: 12, y: 8 } })
      await occPage.keyboard.press('ControlOrMeta+a')
      await occPage.getByRole('button', { name: 'Bold', exact: true }).first().click()

      await expect(editor.locator('strong').first()).toBeVisible()
      await expect(editor.locator('img')).toHaveCount(1)
      await expectNoRichMarkdownSchemaCrash(occPage, pageErrors)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
