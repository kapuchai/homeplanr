import { expect, test, type Page } from '@playwright/test'

/**
 * Walk-mode smoke (M6): draw a room → 3D → arm Walk → click the floor →
 * the walk camera renders a non-blank frame → Esc glides back out and the
 * Walk button disarms. Mirrors smoke.spec's setup conventions.
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

test('walk mode: arm → click floor → walking renders → Esc exits', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await expect(page.locator('svg.editor-canvas text').filter({ hasText: 'm²' })).toBeVisible()

  // --- 3D view up and rendering ---
  await page.getByRole('button', { name: '3D', exact: true }).click()
  const gl = page.locator('.view-3d canvas')
  await expect(gl).toBeVisible()
  await page.waitForTimeout(800) // first frame + env

  // --- arm walk mode and step onto the floor ---
  const walkBtn = page.getByRole('button', { name: 'Walk' })
  await walkBtn.click()
  await expect(walkBtn).toHaveClass(/active/)
  const box = (await gl.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(1000) // enter glide (0.65s) + settled frames

  // eye-level frame is non-blank (blank canvases compress tiny)
  const shot = await gl.screenshot()
  expect(shot.byteLength).toBeGreaterThan(10_000)
  await expect(walkBtn).toHaveClass(/active/)

  // --- Esc glides back to the orbit pose and disarms ---
  await page.keyboard.press('Escape')
  await expect(walkBtn).not.toHaveClass(/active/)
})
