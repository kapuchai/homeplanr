// Per-instance coloring (0.9.0): per-slot color inputs commit overrides,
// reset returns to the slot default. 3D resolve is covered by the rig pass.
import { test, expect } from '@playwright/test'
import { drawRoom, placeFurniture } from './helpers'

test('slot color override commits and resets', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await placeFurniture(page)

  const panel = page.locator('.props-panel')
  await expect(panel.getByRole('heading', { name: 'Colors' })).toBeVisible()
  const input = panel.locator('.color-slot input').first()
  const original = await input.inputValue()

  await input.fill('#ff0000')
  await page.keyboard.press('Tab') // draft-commit on blur (one undo entry)
  await expect(input).toHaveValue('#ff0000')
  const reset = panel.locator('.color-slot .swatch-none').first()
  await expect(reset).toBeVisible()

  // survives a selection roundtrip (the override is doc state, not draft)
  await page.keyboard.press('Escape')
  await placeFurniture(page, 'Armchair', 0.6, 0.6)
  await page.keyboard.press('Escape')
  const sofa = await pageClickSofa(page)
  void sofa
  await expect(panel.locator('.color-slot input').first()).toHaveValue('#ff0000')

  await panel.locator('.color-slot .swatch-none').first().click()
  await expect(panel.locator('.color-slot input').first()).toHaveValue(original)
  await expect(panel.locator('.color-slot .swatch-none')).toHaveCount(0)
})

/** Re-select the sofa placed at the default canvas center. */
async function pageClickSofa(page: import('@playwright/test').Page) {
  const canvas = page.locator('svg.editor-canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
}
