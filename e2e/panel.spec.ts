import { expect, test, type Page } from '@playwright/test'
import { canvasPoint, drawRoom, placeFurniture } from './helpers'

/**
 * Properties-panel commit safety (B1, 0.5.0): draft-buffered fields commit
 * to the entity that was selected WHEN TYPING BEGAN. Selection swaps at
 * pointerdown re-render the panel before blur — the typed value must
 * neither misdirect into the newly clicked entity nor drop silently; Esc
 * reverts without committing; Enter commits in place.
 */

const thicknessInput = (page: Page) =>
  page.locator('.prop-field', { hasText: 'Thickness' }).locator('input')

// walls drawn `exact` land precisely on the click fractions
async function selectTopWall(page: Page) {
  const p = await canvasPoint(page, 0.5, 0.3)
  await page.mouse.click(p.x, p.y)
  await expect(page.locator('.props-panel h3')).toHaveText('Wall')
}

async function selectLeftWall(page: Page) {
  const p = await canvasPoint(page, 0.3, 0.5)
  await page.mouse.click(p.x, p.y)
  await expect(page.locator('.props-panel h3')).toHaveText('Wall')
}

test('typed thickness commits to the wall it was typed for, not the next-clicked one', async ({
  page,
}) => {
  await page.goto('/')
  await drawRoom(page, { exact: true })
  await selectTopWall(page)
  const original = await thicknessInput(page).inputValue()

  await thicknessInput(page).fill('0.42')
  await selectLeftWall(page) // pointerdown swaps selection mid-edit

  // the freshly clicked wall is untouched…
  await expect(thicknessInput(page)).toHaveValue(original)
  // …and the wall the value was typed for received it
  await selectTopWall(page)
  await expect(thicknessInput(page)).toHaveValue('0.42')
})

test('deselecting (click on empty canvas) still commits to the edited wall', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page, { exact: true })
  await selectTopWall(page)

  await thicknessInput(page).fill('0.28')
  const empty = await canvasPoint(page, 0.12, 0.12)
  await page.mouse.click(empty.x, empty.y)
  await expect(page.locator('.props-panel h3')).toHaveText('Project')

  await selectTopWall(page)
  await expect(thicknessInput(page)).toHaveValue('0.28')
})

test('Esc reverts the draft without committing', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page, { exact: true })
  await selectTopWall(page)
  const original = await thicknessInput(page).inputValue()

  await thicknessInput(page).fill('0.35')
  await page.keyboard.press('Escape')
  await expect(thicknessInput(page)).toHaveValue(original)

  // the doc value never changed either (reselect re-reads the store)
  await selectLeftWall(page)
  await selectTopWall(page)
  await expect(thicknessInput(page)).toHaveValue(original)
})

test('Enter commits in place', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page, { exact: true })
  await selectTopWall(page)

  await thicknessInput(page).fill('0.5')
  await page.keyboard.press('Enter')
  await expect(thicknessInput(page)).toHaveValue('0.5')

  await selectLeftWall(page)
  await selectTopWall(page)
  await expect(thicknessInput(page)).toHaveValue('0.5')
})

test('text field (furniture name): Esc reverts without committing', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page, { exact: true })
  await placeFurniture(page, 'Sofa, 3-seat', 0.5, 0.5)
  const p = await canvasPoint(page, 0.5, 0.5)
  await page.mouse.click(p.x, p.y)
  await expect(page.locator('.props-panel h3')).toHaveText('Sofa, 3-seat')

  const name = page.locator('.prop-field', { hasText: 'Name' }).locator('input')
  await name.fill('My sofa')
  await page.keyboard.press('Escape')
  await expect(name).toHaveValue('')
})
