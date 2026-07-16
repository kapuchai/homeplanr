import { expect, test } from '@playwright/test'
import { drawRoom, show3d } from './helpers'

/**
 * Walk-mode smoke (M6): draw a room → 3D → arm Walk → click the floor →
 * the walk camera renders a non-blank frame → Esc glides back out and the
 * Walk button disarms. Mirrors smoke.spec's setup conventions.
 */

test('walk mode: arm → click floor → walking renders → Esc exits', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await expect(page.locator('svg.editor-canvas text').filter({ hasText: 'm²' })).toBeVisible()

  // --- 3D view up and rendering ---
  const gl = await show3d(page)

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
