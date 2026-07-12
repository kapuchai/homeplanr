import { expect, test, type Page } from '@playwright/test'

/**
 * Marquee multi-select smoke (0.3.0 M3): draw a room, place two sofas,
 * rubber-band across everything, batch-delete, undo restores. Mirrors
 * smoke.spec's setup conventions.
 */

async function drawRoom(page: Page) {
  const canvas = page.locator('svg.editor-canvas')
  await expect(canvas).toBeVisible()
  await page.keyboard.press('w')
  const box = (await canvas.boundingBox())!
  const at = (fx: number, fy: number) =>
    ({ x: box.x + box.width * fx, y: box.y + box.height * fy }) as const
  const corners = [at(0.3, 0.3), at(0.7, 0.3), at(0.7, 0.7), at(0.3, 0.7)]
  for (const c of corners) {
    await page.mouse.click(c.x, c.y)
    await page.waitForTimeout(350) // > double-click window
  }
  await page.mouse.click(corners[0]!.x, corners[0]!.y) // close the loop
  await page.keyboard.press('Escape')
}

test('marquee select → batch delete → undo restores', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await expect(page.locator('svg.editor-canvas text').filter({ hasText: 'm²' })).toBeVisible()

  const canvas = page.locator('svg.editor-canvas')
  const box = (await canvas.boundingBox())!
  const at = (fx: number, fy: number) =>
    ({ x: box.x + box.width * fx, y: box.y + box.height * fy }) as const

  // place two sofas inside the room (click-to-place stays armed)
  await page.locator('.catalog-card', { hasText: 'Sofa, 3-seat' }).click()
  await page.mouse.click(at(0.42, 0.5).x, at(0.42, 0.5).y)
  await page.waitForTimeout(350) // dodge the place double-fire window
  await page.mouse.click(at(0.58, 0.5).x, at(0.58, 0.5).y)
  await page.keyboard.press('Escape') // disarm → back to select

  // marquee from outside the room across everything
  const from = at(0.2, 0.2)
  const to = at(0.8, 0.8)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()

  // 4 walls + 2 sofas selected → properties shows the multi-select count
  await expect(page.locator('.props-panel')).toContainText('6 items')

  // batch delete empties the canvas (room label gone), undo restores it
  await page.keyboard.press('Delete')
  await expect(page.locator('svg.editor-canvas text').filter({ hasText: 'm²' })).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.locator('svg.editor-canvas text').filter({ hasText: 'm²' })).toBeVisible()
})

test('Ctrl+A selects everything; Escape clears', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await expect(page.locator('svg.editor-canvas text').filter({ hasText: 'm²' })).toBeVisible()
  await page.keyboard.press('Control+a')
  await expect(page.locator('.props-panel')).toContainText('4 items')
  await page.keyboard.press('Escape')
  await expect(page.locator('.props-panel')).not.toContainText('4 items')
})
