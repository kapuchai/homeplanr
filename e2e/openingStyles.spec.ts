// Opening styles (0.10.0): mode-aware catalog panel, style-armed placement,
// and PropertiesPanel restyling. Glyph geometry is pinned by unit tests;
// this covers the UI wiring.
import { test, expect } from '@playwright/test'
import { canvasPoint, drawRoom, placeOpening } from './helpers'

test('door tool swaps the catalog panel to style cards; placement stamps the style', async ({
  page,
}) => {
  await page.goto('/')
  await drawRoom(page, { exact: true })

  // furniture catalog by default
  const panel = page.locator('.catalog-panel')
  await expect(panel.locator('.catalog-search')).toBeVisible()

  // door tool → six style cards, Standard armed
  await page.getByRole('button', { name: 'Door', exact: true }).click()
  await expect(panel.getByText('Door styles')).toBeVisible()
  await expect(panel.locator('.catalog-card')).toHaveCount(6)
  await expect(panel.locator('.catalog-card.armed')).toHaveText(/Standard/)

  // arm Sliding, place on the bottom wall, select it
  await panel.locator('.catalog-card', { hasText: 'Sliding' }).click()
  await expect(panel.locator('.catalog-card.armed')).toHaveText(/Sliding/)
  const p = await canvasPoint(page, 0.5, 0.7)
  await page.mouse.click(p.x, p.y)
  await page.keyboard.press('Escape')
  await page.mouse.click(p.x, p.y)

  // properties panel shows the door with the Sliding chip active
  const props = page.locator('.props-panel')
  await expect(props.locator('h3')).toHaveText('Door')
  await expect(props.locator('.chip.active')).toHaveText('Sliding')

  // restyle in place → Double
  await props.locator('.chip', { hasText: 'Double' }).click()
  await expect(props.locator('.chip.active')).toHaveText('Double')

  // switching to select restored the furniture catalog
  await expect(panel.locator('.catalog-search')).toBeVisible()
})

test('window styles: full-height placement seeds sill 0; restyle forces it too', async ({
  page,
}) => {
  await page.goto('/')
  await drawRoom(page, { exact: true })

  await page.getByRole('button', { name: 'Window', exact: true }).click()
  const panel = page.locator('.catalog-panel')
  await expect(panel.getByText('Window styles')).toBeVisible()
  await expect(panel.locator('.catalog-card')).toHaveCount(4)

  // place a full-height window on the top wall
  await placeOpening(page, 'window', 0.5, 0.3, 'Full-height')
  const p = await canvasPoint(page, 0.5, 0.3)
  await page.mouse.click(p.x, p.y)

  const props = page.locator('.props-panel')
  await expect(props.locator('h3')).toHaveText('Window')
  await expect(props.locator('.chip.active')).toHaveText('Full-height')
  const sill = props.locator('.prop-field', { hasText: 'Sill height' }).locator('input')
  await expect(sill).toHaveValue('0')

  // restyle to Standard (keeps sill), then back to Full-height (forces 0)
  await props.locator('.chip', { hasText: 'Standard' }).click()
  await expect(sill).toHaveValue('0') // restyle keeps user dims
  await sill.fill('0.9')
  await sill.press('Enter')
  await props.locator('.chip', { hasText: 'Full-height' }).click()
  await expect(sill).toHaveValue('0') // the one structural exception
})

test('per-kind style memory: door remembers Sliding while window arms Panorama', async ({
  page,
}) => {
  await page.goto('/')
  await drawRoom(page, { exact: true })

  const panel = page.locator('.catalog-panel')
  await page.getByRole('button', { name: 'Door', exact: true }).click()
  await panel.locator('.catalog-card', { hasText: 'Sliding' }).click()

  await page.getByRole('button', { name: 'Window', exact: true }).click()
  await panel.locator('.catalog-card', { hasText: 'Panorama' }).click()

  await page.getByRole('button', { name: 'Door', exact: true }).click()
  await expect(panel.locator('.catalog-card.armed')).toHaveText(/Sliding/)
  await page.getByRole('button', { name: 'Window', exact: true }).click()
  await expect(panel.locator('.catalog-card.armed')).toHaveText(/Panorama/)
})
