// Curtain window-attachment (0.9.0 Phase B): placement near a window
// captures + attaches (derived width), Detach releases. The follow-the-
// window behavior is pinned by unit tests (model/mutations/attachment.test)
// and the manual rig pass — dragging in e2e is too position-brittle.
import { test, expect } from '@playwright/test'
import { canvasPoint, drawRoom, placeFurniture } from './helpers'

test('curtains attach to a window on placement; Detach releases', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page, { exact: true })

  await page.getByRole('button', { name: 'Window', exact: true }).click()
  const w = await canvasPoint(page, 0.5, 0.3)
  await page.mouse.click(w.x, w.y)
  await page.keyboard.press('Escape')

  await placeFurniture(page, 'Curtains', 0.5, 0.33)
  const panel = page.locator('.props-panel')
  await expect(panel.getByText('On window')).toBeVisible()
  // width derives from the window: 1.2 + 2×0.15 overhang
  await expect(panel.locator('.prop-field', { hasText: 'Width' }).locator('input')).toHaveValue(
    '1.5',
  )

  await panel.getByRole('button', { name: 'Detach' }).click()
  await expect(panel.getByText('On window')).toHaveCount(0)
})
