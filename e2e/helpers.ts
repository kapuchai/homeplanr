import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test'

/**
 * Shared helpers for the e2e specs AND ad-hoc probe specs (testing rig
 * Tier 0, 0.5.0). Non-.spec files under e2e/ are imported, never run.
 *
 * Conventions (inherited from the 0.2.0-era specs):
 * - Canvas coordinates are FRACTIONS of the editor canvas bounding box.
 * - Waits between draw clicks stay > the 350 ms double-click window.
 * - Per-test contexts start with EMPTY localStorage; seedAppSettings must
 *   run BEFORE the first page.goto().
 */

export type Point = { x: number; y: number }

/** World-canvas point at a bounding-box fraction; asserts the canvas first. */
export async function canvasPoint(page: Page, fx: number, fy: number): Promise<Point> {
  const canvas = page.locator('svg.editor-canvas')
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

const DEFAULT_CORNERS: readonly (readonly [number, number])[] = [
  [0.3, 0.3],
  [0.7, 0.3],
  [0.7, 0.7],
  [0.3, 0.7],
]

/**
 * Draw a closed room with the wall tool at canvas fractions.
 * `exact` holds Ctrl to suspend snapping so walls land EXACTLY at the click
 * fractions (needed when later clicks must hit entities deterministically).
 */
export async function drawRoom(
  page: Page,
  opts: { exact?: boolean; corners?: readonly (readonly [number, number])[] } = {},
) {
  const { exact = false, corners = DEFAULT_CORNERS } = opts
  const canvas = page.locator('svg.editor-canvas')
  await expect(canvas).toBeVisible()
  await page.keyboard.press('w')
  const box = (await canvas.boundingBox())!
  const pts = corners.map(([fx, fy]) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  }))
  if (exact) await page.keyboard.down('Control')
  for (const c of pts) {
    await page.mouse.click(c.x, c.y)
    await page.waitForTimeout(350) // > double-click window
  }
  await page.mouse.click(pts[0]!.x, pts[0]!.y) // close the loop
  if (exact) await page.keyboard.up('Control')
  await page.keyboard.press('Escape')
}

/** Click-to-place a catalog item at a canvas fraction, then disarm. */
export async function placeFurniture(page: Page, name = 'Sofa, 3-seat', fx = 0.5, fy = 0.5) {
  await page.locator('.catalog-card', { hasText: name }).click()
  const p = await canvasPoint(page, fx, fy)
  await page.mouse.click(p.x, p.y)
  await page.keyboard.press('Escape') // disarm click-to-place
}

/**
 * Switch to the 3D view (the subtree lazy-mounts on first use) and wait out
 * the first frame + environment; returns the WebGL canvas locator.
 */
export async function show3d(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '3D', exact: true }).click()
  const gl = page.locator('.view-3d canvas')
  await expect(gl).toBeVisible()
  await page.waitForTimeout(800) // first frame + env
  return gl
}

export async function show2d(page: Page) {
  await page.getByRole('button', { name: '2D', exact: true }).click()
}

/** Click a camera preset in the 3D overlay controls and let the glide settle. */
export async function cameraPreset(page: Page, name: 'Top' | 'Front' | 'Iso' | 'Reset') {
  await page.locator('.view3d-controls').getByRole('button', { name, exact: true }).click()
  await page.waitForTimeout(1000) // pose glide + settled frames
}

// --- dialogs ---------------------------------------------------------------

export const optionsDialog = (page: Page) => page.getByRole('dialog', { name: 'Options' })

export async function openOptions(page: Page) {
  await page.getByRole('button', { name: 'Options' }).click()
  await expect(optionsDialog(page)).toBeVisible()
}

export async function closeOptions(page: Page) {
  await optionsDialog(page).getByRole('button', { name: 'Close' }).click()
  await expect(optionsDialog(page)).toBeHidden()
}

export const exportDialog = (page: Page) => page.getByRole('dialog', { name: 'Export plan' })

export async function openExport(page: Page) {
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Export…' }).click()
  await expect(exportDialog(page)).toBeVisible()
}

/** File → New: <template>. Waits for the plan to render (any m² room label). */
export async function newFromTemplate(page: Page, name = 'Studio 25 m²') {
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: `New: ${name}` }).click()
  await expect(
    page.locator('svg.editor-canvas text').filter({ hasText: 'm²' }).first(),
  ).toBeVisible()
}

// --- environment -----------------------------------------------------------

/**
 * Seed device prefs BEFORE the first navigation. parseAppSettings requires
 * `v: 1` and validates per-field (bad fields fall back silently), and
 * initTheming stamps <html data-theme> from this before the first frame —
 * so a seeded theme never flashes.
 */
export async function seedAppSettings(context: BrowserContext, settings: Record<string, unknown>) {
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key!, value!),
    ['homeplanr:v1:app-settings', JSON.stringify({ v: 1, ...settings })] as const,
  )
}

/** Resolve the crash-recovery prompt that blocks after reload-with-unsaved-work. */
export async function dismissRecovery(page: Page, action: 'Restore' | 'Discard' = 'Restore') {
  await expect(page.locator('.modal h3')).toHaveText('Restore unsaved work?')
  await page.getByRole('button', { name: action }).click()
}
