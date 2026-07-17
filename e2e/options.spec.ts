import { expect, test } from '@playwright/test'
import { closeOptions, openOptions, optionsDialog as dialog } from './helpers'

/**
 * Options dialog: theme + units apply instantly and persist across reload.
 *
 * Isolation note (as in smoke.spec.ts): Playwright's per-test browser
 * contexts start with EMPTY localStorage, so tests are order-independent
 * without manual clearing. Each test still restores the defaults it changed
 * so the storage it leaves behind stays neutral.
 */

test('dark theme applies and persists', async ({ page }) => {
  await page.goto('/')
  // config pins colorScheme: 'light', so the default (System) resolves light
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await openOptions(page)
  await dialog(page).getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await closeOptions(page)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  // restore Light so the storage left behind stays neutral
  await openOptions(page)
  await dialog(page).getByRole('button', { name: 'Light', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await closeOptions(page)
})

test('units switch updates the properties panel', async ({ page }) => {
  await page.goto('/')
  // nothing selected → the panel shows project settings; grid size is a
  // LengthField whose suffix tracks the unit system
  await expect(page.locator('.props-panel h3')).toHaveText('Project')
  const gridUnit = page.locator('.props-panel .prop-input em').first()
  await expect(gridUnit).toHaveText('m')

  await openOptions(page)
  await dialog(page).getByRole('button', { name: 'cm', exact: true }).click()
  await closeOptions(page)
  await expect(gridUnit).toHaveText('cm')

  await page.reload()
  await expect(gridUnit).toHaveText('cm')
  await openOptions(page)
  await expect(dialog(page).getByRole('button', { name: 'cm', exact: true })).toHaveClass(/active/)

  // restore metres so the storage left behind stays neutral
  await dialog(page).getByRole('button', { name: 'm', exact: true }).click()
  await closeOptions(page)
  await expect(gridUnit).toHaveText('m')
})

test('a11y baseline (M7): focus trap, Esc + focus restore, ARIA state', async ({ page }) => {
  await page.goto('/')
  const gear = page.getByRole('button', { name: 'Options' })
  await gear.click()
  await expect(dialog(page)).toBeVisible()
  // focus moved INTO the dialog
  const inDialog = await dialog(page).evaluate((d) => d.contains(document.activeElement))
  expect(inDialog).toBe(true)
  // active theme button exposes aria-pressed
  await expect(
    dialog(page).getByRole('button', { name: 'System', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  // Escape closes and focus RESTORES to the opener
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await expect(gear).toBeFocused()

  // File menu: ARIA menu semantics + Esc restores the trigger
  const fileBtn = page.getByRole('button', { name: 'File' })
  await expect(fileBtn).toHaveAttribute('aria-haspopup', 'menu')
  await fileBtn.click()
  await expect(page.getByRole('menuitem', { name: 'New Ctrl+N' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'New: Studio 25 m²' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(fileBtn).toBeFocused()
})

test('3D view section (0.11.0): toggles persist across reload', async ({ page }) => {
  await page.goto('/')
  await openOptions(page)
  const collision = () =>
    dialog(page).locator('.options-row', { hasText: 'Walk collision' })
  const hiding = () => dialog(page).locator('.options-row', { hasText: 'Hide facing walls' })
  await expect(collision().getByRole('button', { name: 'On', exact: true })).toHaveClass(/active/)
  await expect(hiding().getByRole('button', { name: 'On', exact: true })).toHaveClass(/active/)

  // turn collision and wall hiding off (ceilings stay default-on)
  await collision().getByRole('button', { name: 'Off', exact: true }).click()
  await hiding().getByRole('button', { name: 'Off', exact: true }).click()
  await closeOptions(page)

  await page.reload()
  await openOptions(page)
  await expect(collision().getByRole('button', { name: 'Off', exact: true })).toHaveClass(/active/)
  await expect(hiding().getByRole('button', { name: 'Off', exact: true })).toHaveClass(/active/)

  // restore defaults so the storage left behind stays neutral
  await collision().getByRole('button', { name: 'On', exact: true }).click()
  await hiding().getByRole('button', { name: 'On', exact: true }).click()
  await closeOptions(page)
})
