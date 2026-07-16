import { expect, test } from '@playwright/test'
import { canvasPoint, dismissRecovery, drawRoom, placeFurniture, show2d, show3d } from './helpers'

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

test('draw → furnish → 3D → crash recovery', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.toolbar .brand')).toHaveText('homeplanr')
  await expect(page.locator('.empty-state')).toBeVisible()

  // --- draw a rectangular room ---
  await drawRoom(page)
  await expect(page.locator('svg.editor-canvas text').filter({ hasText: 'm²' })).toBeVisible()

  // --- place furniture via click-to-place, then select it ---
  await placeFurniture(page, 'Sofa, 3-seat', 0.5, 0.5)
  const p = await canvasPoint(page, 0.5, 0.5)
  await page.mouse.click(p.x, p.y)
  await expect(page.locator('.props-panel h3')).toHaveText('Sofa, 3-seat')

  // --- toggle 3D: canvas mounts and renders non-blank ---
  const gl = await show3d(page)
  const shot = await gl.screenshot()
  expect(shot.byteLength).toBeGreaterThan(10_000) // blank canvases compress tiny
  await show2d(page)

  // --- crash recovery: reload with unsaved work ---
  await page.waitForTimeout(700) // > autosave debounce
  await page.reload()
  await dismissRecovery(page, 'Restore')
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
