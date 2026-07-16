import { expect, test } from '@playwright/test'
import {
  cameraPreset,
  closeOptions,
  exportDialog,
  newFromTemplate,
  openExport,
  openOptions,
  optionsDialog,
  show3d,
} from './helpers'

/**
 * Visual-diff baselines (testing rig Tier 0, 0.5.0). These are the LOCAL
 * agent rig, not a CI gate: baselines are chromium-on-this-box renders
 * (font rasterization differs on CI runners) and CI already runs the
 * functional suite. Rebaseline after INTENTIONAL visual changes:
 *
 *   npx playwright test --project=chromium e2e/visual.spec.ts --update-snapshots
 *
 * The 3D shot is WebGL — when the full suite is loaded, run this spec
 * isolated (RUNBOOK: headless-GL first-frame starvation).
 */

test.skip(!!process.env.CI, 'local agent rig — not a CI gate')
test.skip(({ browserName }) => browserName !== 'chromium', 'baselines are chromium-only')

const SETTLE = 300 // template swap re-fits the viewport; let layers redraw

test('2D plan — studio template', async ({ page }) => {
  await page.goto('/')
  await newFromTemplate(page)
  await page.waitForTimeout(SETTLE)
  await expect(page.locator('.editor-viewport')).toHaveScreenshot('2d-studio.png')
})

test('2D plan — dimensions shown', async ({ page }) => {
  await page.goto('/')
  await newFromTemplate(page)
  await page.keyboard.press('Shift+D')
  await page.waitForTimeout(SETTLE)
  await expect(page.locator('.editor-viewport')).toHaveScreenshot('2d-studio-dims.png')
})

test('2D plan + toolbar — dark mode', async ({ page }) => {
  await page.goto('/')
  await newFromTemplate(page)
  await openOptions(page)
  await optionsDialog(page).getByRole('button', { name: 'Dark', exact: true }).click()
  await closeOptions(page)
  await page.waitForTimeout(SETTLE)
  await expect(page.locator('.editor-viewport')).toHaveScreenshot('2d-studio-dark.png')
  await expect(page.locator('.toolbar')).toHaveScreenshot('toolbar-dark.png')
})

test('toolbar — light mode', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.toolbar .brand')).toHaveText('homeplanr')
  await expect(page.locator('.toolbar')).toHaveScreenshot('toolbar.png')
})

test('3D isometric view — studio template', async ({ page }) => {
  await page.goto('/')
  await newFromTemplate(page)
  const gl = await show3d(page)
  await cameraPreset(page, 'Iso')
  // WebGL output wobbles more than DOM renders — wider tolerance
  await expect(gl).toHaveScreenshot('3d-iso.png', { maxDiffPixelRatio: 0.03 })
})

test('options dialog', async ({ page }) => {
  await page.goto('/')
  await openOptions(page)
  await expect(optionsDialog(page)).toHaveScreenshot('options-dialog.png')
})

test('export dialog — PDF paper controls', async ({ page }) => {
  await page.goto('/')
  await openExport(page)
  await exportDialog(page).getByRole('button', { name: 'PDF' }).click()
  await expect(exportDialog(page).getByText('Orientation')).toBeVisible()
  await expect(exportDialog(page)).toHaveScreenshot('export-dialog-pdf.png')
})

test('shortcut sheet', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('?')
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveScreenshot('shortcut-sheet.png')
})
