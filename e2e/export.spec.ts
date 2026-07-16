import { expect, test, type Page } from '@playwright/test'

/**
 * Export dialog (M5, 0.4.0): File → Export… opens the modal; the PDF format
 * reveals the paper section; Escape closes with focus restored. The actual
 * byte outputs ride the packaged manual gate (native save dialogs).
 */

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export plan' })

async function openExport(page: Page) {
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Export…' }).click()
  await expect(dialog(page)).toBeVisible()
}

test('export dialog: format switch reveals paper controls; Esc closes', async ({ page }) => {
  await page.goto('/')
  await openExport(page)

  // defaults: PNG + Fit; no paper section
  await expect(dialog(page).getByRole('button', { name: 'PNG' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(dialog(page).getByText('Orientation')).toBeHidden()

  // PDF reveals paper size / orientation / title block
  await dialog(page).getByRole('button', { name: 'PDF' }).click()
  await expect(dialog(page).getByText('Orientation')).toBeVisible()
  await expect(dialog(page).getByRole('button', { name: 'A4' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // scale presets present
  await expect(dialog(page).getByRole('button', { name: '1:100' })).toBeVisible()

  // Esc closes (shared Modal shell)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
})

test('export dialog: Cancel closes without exporting', async ({ page }) => {
  await page.goto('/')
  await openExport(page)
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog(page)).toBeHidden()
})
