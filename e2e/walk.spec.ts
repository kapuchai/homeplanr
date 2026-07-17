import { expect, test } from '@playwright/test'
import { drawRoom, show3d } from './helpers'

/**
 * Walk-mode smoke (0.11.0): draw a room → 3D → click Walk → the walk
 * camera drops straight in at a default spot (no floor pick) and renders a
 * non-blank frame → Esc glides back out and the Walk button disarms.
 * (Pointer Lock can't be driven under Playwright, so this exercises entry
 * + render + exit, not the mouse-look itself.)
 */

test('walk mode: click Walk → enters + renders → Esc exits', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await expect(page.locator('svg.editor-canvas text').filter({ hasText: 'm²' })).toBeVisible()

  // --- 3D view up and rendering ---
  const gl = await show3d(page)

  // --- one click on Walk enters walk mode directly (no floor pick) ---
  const walkBtn = page.getByRole('button', { name: 'Walk' })
  await walkBtn.click()
  await expect(walkBtn).toHaveClass(/active/)
  await page.waitForTimeout(1000) // enter glide (0.65s) + settled frames

  // eye-level frame is non-blank (blank canvases compress tiny)
  const shot = await gl.screenshot()
  expect(shot.byteLength).toBeGreaterThan(10_000)
  await expect(walkBtn).toHaveClass(/active/)

  // --- Esc glides back to the orbit pose and disarms ---
  await page.keyboard.press('Escape')
  await expect(walkBtn).not.toHaveClass(/active/)
})
