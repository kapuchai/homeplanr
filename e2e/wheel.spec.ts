import { expect, test, type Page } from '@playwright/test'
import { canvasPoint, closeOptions, drawRoom, openOptions, optionsDialog } from './helpers'

/**
 * Wheel matrix (B2, 0.5.0): plain wheel zooms by default; Space+wheel pans
 * both axes; the 'Pan (trackpad)' wheel mode flips the plain wheel to
 * panning with ctrl+wheel (browser pinch) still zooming.
 */

const zoomLevel = (page: Page) => page.locator('.zoom-level')
const worldTransform = (page: Page) =>
  page.locator('svg.editor-canvas > g').first().getAttribute('transform')

async function hoverCanvas(page: Page) {
  const p = await canvasPoint(page, 0.5, 0.5)
  await page.mouse.move(p.x, p.y)
}

test('plain wheel zooms in the default mode', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await hoverCanvas(page)
  const before = (await zoomLevel(page).textContent())!
  await page.mouse.wheel(0, -240)
  await expect(zoomLevel(page)).not.toHaveText(before)
})

test('Space+wheel pans both axes without zooming', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await hoverCanvas(page)
  const zoomBefore = (await zoomLevel(page).textContent())!
  const tBefore = await worldTransform(page)
  await page.keyboard.down(' ')
  await page.mouse.wheel(40, -240)
  await page.keyboard.up(' ')
  await expect(zoomLevel(page)).toHaveText(zoomBefore)
  expect(await worldTransform(page)).not.toBe(tBefore)
})

test('trackpad mode: wheel pans, ctrl+wheel (pinch) still zooms', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await openOptions(page)
  await optionsDialog(page).getByRole('button', { name: 'Pan (trackpad)' }).click()
  await closeOptions(page)

  await hoverCanvas(page)
  const zoomBefore = (await zoomLevel(page).textContent())!
  const tBefore = await worldTransform(page)
  await page.mouse.wheel(0, 240)
  await expect(zoomLevel(page)).toHaveText(zoomBefore)
  expect(await worldTransform(page)).not.toBe(tBefore)

  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -240)
  await page.keyboard.up('Control')
  await expect(zoomLevel(page)).not.toHaveText(zoomBefore)

  // restore the default so the storage left behind stays neutral
  await openOptions(page)
  await optionsDialog(page).getByRole('button', { name: 'Zoom', exact: true }).click()
  await closeOptions(page)
})
