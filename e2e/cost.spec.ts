// Price/notes + cost surfaces (0.9.0): per-item price commits, the mixed
// selection shows a priced-items sum, and the empty-selection plan stats
// carry the project cost line.
import { test, expect } from '@playwright/test'
import { canvasPoint, drawRoom, placeFurniture } from './helpers'

test('prices sum into selection and project cost', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  const panel = page.locator('.props-panel')
  const priceInput = () => panel.locator('.prop-field', { hasText: 'Price' }).locator('input')

  await placeFurniture(page, 'Sofa, 3-seat', 0.45, 0.5)
  await priceInput().fill('499.5')
  await page.keyboard.press('Enter')

  await placeFurniture(page, 'Armchair', 0.6, 0.6)
  await priceInput().fill('150')
  await page.keyboard.press('Enter')
  // notes ride the same panel
  await panel.locator('.prop-notes textarea').fill('window display model')
  await page.keyboard.press('Tab') // commit (Esc would revert)

  // hand focus back to the canvas before the select-all shortcut
  const empty = await canvasPoint(page, 0.1, 0.1)
  await page.mouse.click(empty.x, empty.y) // outside the room: deselects
  await page.keyboard.press('Control+a')
  await expect(panel.getByText('Cost (2 priced)')).toBeVisible()
  await expect(panel.getByText('649.50 €')).toBeVisible()

  // empty selection: the plan-statistics block shows the project total
  await page.keyboard.press('Escape')
  await expect(panel.getByText('Project cost (2 items)')).toBeVisible()
  await expect(panel.getByText('649.50 €')).toBeVisible()
})
