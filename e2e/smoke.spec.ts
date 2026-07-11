import { expect, test, type Page } from '@playwright/test'

/**
 * The core-loop smoke (plan-pinned): draw a room with synthetic pointers →
 * place furniture → toggle 3D (non-blank canvas) → reload → crash recovery
 * restores the work.
 *
 * Isolation note: Playwright's per-test browser contexts start with EMPTY
 * localStorage (the tauri-dev webview's storage lives in WebKitGTK's data
 * dir — fully separate), so no manual clearing is needed. An addInitScript
 * clear would run on EVERY navigation and wipe the recovery blob mid-test.
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

test('draw → furnish → 3D → crash recovery', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.toolbar .brand')).toHaveText('homeplanr')
  await expect(page.locator('.empty-state')).toBeVisible()

  // --- draw a rectangular room ---
  await drawRoom(page)
  await expect(page.locator('svg.editor-canvas text').filter({ hasText: 'm²' })).toBeVisible()

  // --- place furniture via click-to-place ---
  await page.locator('.catalog-card', { hasText: 'Sofa, 3-seat' }).click()
  const canvasBox = (await page.locator('svg.editor-canvas').boundingBox())!
  await page.mouse.click(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.5)
  await page.keyboard.press('Escape') // disarm
  // select it → properties panel shows the item
  await page.mouse.click(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.5)
  await expect(page.locator('.props-panel h3')).toHaveText('Sofa, 3-seat')

  // --- toggle 3D: canvas mounts and renders non-blank ---
  await page.getByRole('button', { name: '3D', exact: true }).click()
  const gl = page.locator('.view-3d canvas')
  await expect(gl).toBeVisible()
  await page.waitForTimeout(800) // first frame + env
  const shot = await gl.screenshot()
  expect(shot.byteLength).toBeGreaterThan(10_000) // blank canvases compress tiny
  await page.getByRole('button', { name: '2D', exact: true }).click()

  // --- crash recovery: reload with unsaved work ---
  await page.waitForTimeout(700) // > autosave debounce
  await page.reload()
  await expect(page.locator('.modal h3')).toHaveText('Restore unsaved work?')
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.locator('svg.editor-canvas text').filter({ hasText: 'm²' })).toBeVisible()
  await expect(page.locator('.dirty-dot')).toBeVisible()
})

test('undo/redo round-trip via keyboard', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  const label = page.locator('svg.editor-canvas text').filter({ hasText: 'm²' })
  await expect(label).toBeVisible()
  // 4 walls + closing segment ⇒ ≥4 undo steps; unwind them all
  for (let i = 0; i < 6; i++) await page.keyboard.press('Control+z')
  await expect(label).toHaveCount(0)
  for (let i = 0; i < 6; i++) await page.keyboard.press('Control+Shift+z')
  await expect(label).toBeVisible()
})
