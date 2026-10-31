import { expect, test } from './helpers/occ-app'
import type { Page } from '@stablyai/playwright-test'

type MeterFixture = {
  level: number
  isSpeaking: boolean
  isClipping: boolean
}

async function setDictationVisualState(
  page: Page,
  state: 'listening' | 'stopping',
  meter: MeterFixture,
  partialTranscript = ''
): Promise<void> {
  await page.evaluate(
    ({ dictationState, transcript }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Expected the E2E store to be exposed')
      }
      store.setState({
        dictationState,
        partialTranscript: transcript
      })
    },
    { dictationState: state, transcript: partialTranscript }
  )
  await page.waitForFunction(() => Boolean(window.__dictationMeterE2E))
  await page.evaluate((dictationMeter) => {
    window.__dictationMeterE2E?.publish(dictationMeter)
  }, meter)
}

async function pauseForRecordedProof(page: Page): Promise<void> {
  if (process.env.OCC_E2E_RECORD_VIDEO === '1') {
    await page.waitForTimeout(700)
  }
}

test('dictation grapes react across the visible recording lifecycle', async ({ occPage }) => {
  const quiet = { level: 0, isSpeaking: false, isClipping: false }
  await setDictationVisualState(occPage, 'listening', quiet)

  const indicator = occPage.getByTestId('dictation-indicator')
  const status = indicator.getByRole('status')
  await expect(indicator).toBeVisible()
  await expect(status).toHaveText('Listening')
  await expect(indicator.getByTestId('dictation-grapes').locator('span')).toHaveCount(9)
  await expect(indicator.getByRole('button', { name: 'Stop dictation' })).toBeVisible()
  await occPage.emulateMedia({ reducedMotion: 'reduce' })
  await expect(indicator.getByTestId('dictation-grapes').locator('span').first()).toHaveCSS(
    'transition-property',
    'none'
  )
  await occPage.emulateMedia({ reducedMotion: 'no-preference' })
  await pauseForRecordedProof(occPage)

  const speaking = {
    level: 0.76,
    isSpeaking: true,
    isClipping: false
  }
  await setDictationVisualState(occPage, 'listening', speaking)
  await expect(indicator.getByText('Speaking')).toBeVisible()
  await expect(status).toHaveText('Listening')
  await pauseForRecordedProof(occPage)

  const clipping = { ...speaking, level: 1, isClipping: true }
  await setDictationVisualState(occPage, 'listening', clipping)
  await expect(status).toHaveText('Too loud')
  await expect(indicator).toHaveClass(/text-destructive/)
  await pauseForRecordedProof(occPage)

  await setDictationVisualState(
    occPage,
    'listening',
    speaking,
    'The visualizer follows every word without covering the workspace.'
  )
  await expect(
    occPage.getByText('The visualizer follows every word without covering the workspace.')
  ).toBeVisible()
  await expect(status).toHaveText('Listening')
  await pauseForRecordedProof(occPage)

  await setDictationVisualState(occPage, 'stopping', quiet)
  await expect(status).toHaveText('Processing…')
  await expect(indicator.getByRole('button', { name: 'Stop dictation' })).toHaveCount(0)
  await pauseForRecordedProof(occPage)
})
