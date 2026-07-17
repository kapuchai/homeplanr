import { expect, test } from '@playwright/test'

/**
 * Bundled templates (M6, 0.4.0): File → New: <template> replaces the doc
 * with the starter plan — room labels render, title updates, no dirty mark.
 */
test('new from template: studio plan loads with rooms and furniture', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'New: Studio 25 m²' }).click()

  // room labels are SVG text in the 2D view (scoped to the canvas — the
  // 0.8.0 plan-statistics panel legitimately repeats type names as chrome)
  const canvas = page.locator('svg.editor-canvas')
  await expect(canvas.getByText('Studio', { exact: true })).toBeVisible()
  await expect(canvas.getByText('Bathroom', { exact: true })).toBeVisible()
  // the template's exterior dimension annotation rides along
  await expect(page.getByText('5.60 m')).toBeVisible()
})
