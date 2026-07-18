import { expect, test } from '@playwright/test'
import { drawRoom } from './helpers'

/**
 * Multi-floor (0.13.0): switcher, level-scoped editing, ghost underlay,
 * PgUp/PgDn, rename/duplicate/delete, undo-follow, project notes.
 */

const switcher = (page: import('@playwright/test').Page) =>
  page.locator('.level-switcher')
const rows = (page: import('@playwright/test').Page) =>
  page.locator('.level-switcher .level-rows button')

test('one floor by default; add creates and activates Floor 2', async ({ page }) => {
  await page.goto('/')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toHaveText('Floor 1')
  await switcher(page).getByTitle('Add floor').click()
  await expect(rows(page)).toHaveCount(2)
  // top row = the new top storey, and it is active
  await expect(rows(page).first()).toHaveText('Floor 2')
  await expect(rows(page).first()).toHaveClass(/active/)
})

test('editing is level-scoped and the ghost underlay appears upstairs', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await expect(page.locator('.level-ghost')).toHaveCount(0) // ground floor: nothing below
  await switcher(page).getByTitle('Add floor').click()
  // upstairs: empty level, ghost of the floor below visible
  await expect(page.locator('.empty-state')).toBeVisible()
  await expect(page.locator('.level-ghost')).toHaveCount(1)
  // draw upstairs, then switch down — the upstairs room must not leak
  await drawRoom(page, { corners: [[0.35, 0.35], [0.55, 0.35], [0.55, 0.55], [0.35, 0.55]] })
  await rows(page).nth(1).click()
  await expect(page.locator('.level-ghost')).toHaveCount(0)
  await expect(page.locator('.empty-state')).toBeHidden()
})

test('PgUp/PgDn switch floors from the keyboard', async ({ page }) => {
  await page.goto('/')
  await switcher(page).getByTitle('Add floor').click()
  await rows(page).nth(1).click() // back to Floor 1
  await expect(rows(page).nth(1)).toHaveClass(/active/)
  await page.keyboard.press('PageUp')
  await expect(rows(page).first()).toHaveClass(/active/)
  await page.keyboard.press('PageDown')
  await expect(rows(page).nth(1)).toHaveClass(/active/)
})

test('rename (double-click), duplicate, and delete with confirm', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await rows(page).first().dblclick()
  await page.locator('.level-rename').fill('Ground')
  await page.keyboard.press('Enter')
  await expect(rows(page).first()).toHaveText('Ground')

  await switcher(page).getByTitle('Duplicate floor').click()
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).first()).toHaveText('Ground') // clone keeps the name
  await expect(page.locator('.empty-state')).toBeHidden() // and the walls

  await switcher(page).getByTitle('Delete floor').click()
  await expect(page.getByRole('dialog')).toContainText('Delete floor?')
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(rows(page)).toHaveCount(1)
})

test('undo follows the changed level', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await switcher(page).getByTitle('Add floor').click()
  await drawRoom(page, { corners: [[0.35, 0.35], [0.55, 0.35], [0.55, 0.55], [0.35, 0.55]] })
  await rows(page).nth(1).click() // look at Floor 1
  await expect(rows(page).nth(1)).toHaveClass(/active/)
  await page.keyboard.press('Control+z') // undoes the last Floor 2 wall
  await expect(rows(page).first()).toHaveClass(/active/) // jumped to Floor 2
  await expect(page.locator('.level-ghost')).toHaveCount(1) // floor below shows
})

test('project notes roundtrip through the File menu', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /File/ }).click()
  await page.getByText('Project notes…').click()
  await page.locator('.notes-text').fill('Check loft headroom')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: /File/ }).click()
  await page.getByText('Project notes…').click()
  await expect(page.locator('.notes-text')).toHaveValue('Check loft headroom')
})

test('export dialog offers a floor choice once a second storey exists', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page)
  await page.getByRole('button', { name: /File/ }).click()
  await page.getByText('Export…').click()
  await expect(page.getByRole('dialog')).not.toContainText('Floor 1') // single level: no row
  await page.keyboard.press('Escape')
  await switcher(page).getByTitle('Add floor').click()
  await page.getByRole('button', { name: /File/ }).click()
  await page.getByText('Export…').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Floor 2' })).toHaveClass(/active/) // defaults to the active floor
  await dialog.getByRole('button', { name: 'Floor 1' }).click()
  await expect(dialog.getByRole('button', { name: 'Floor 1' })).toHaveClass(/active/)
  await page.keyboard.press('Escape')
})
