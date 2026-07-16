import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { exportDialog as dialog, newFromTemplate, openExport } from './helpers'

/**
 * Export dialog (M5, 0.4.0): File → Export… opens the modal; the PDF format
 * reveals the paper section; Escape closes with focus restored. PDF bytes
 * are intercepted through the browser adapter's Blob download (B6, 0.5.0);
 * native save dialogs still ride the packaged manual gate.
 */

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

test('fit-mode PDF: one A4 page, embedded font, Cyrillic name intact (B6)', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'download interception is verified on chromium')
  await page.goto('/')
  await newFromTemplate(page)
  // Cyrillic doc name exercises the embedded-font path in the title block —
  // jsPDF's WinAnsi standard fonts garbled it before 0.5.0
  const name = page.getByRole('textbox', { name: 'Project name' })
  await name.fill('Квартира 25 м²')
  await name.press('Enter')

  // any 'Unable to look up font label' warning means some SVG text fell
  // back to a WinAnsi standard font — i.e. a hole in the embedded coverage
  const fontWarnings: string[] = []
  page.on('console', (msg) => {
    if (msg.text().includes('Unable to look up font label')) fontWarnings.push(msg.text())
  })

  await openExport(page)
  await dialog(page).getByRole('button', { name: 'PDF' }).click()
  const downloadP = page.waitForEvent('download')
  await dialog(page).getByRole('button', { name: 'Export…' }).click()
  const download = await downloadP
  expect(download.suggestedFilename()).toBe('Квартира 25 м².pdf')
  expect(fontWarnings).toEqual([])

  const bytes = readFileSync((await download.path())!)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  const pdf = bytes.toString('latin1')
  // exactly one page object (the 0.4.0 bug drew fit-mode content ~976 mm
  // wide off an A4 page — svg2pdf got {w,h} instead of {width,height})
  expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1)
  // A4 in pt, either orientation
  expect(pdf).toMatch(/MediaBox\s*\[0 0 (841\.8|595\.2)\d* (595\.2|841\.8)\d*\]/)
  // a real TTF is embedded — WinAnsi standard fonts carry no FontFile2
  expect(pdf).toContain('/FontFile2')
})
