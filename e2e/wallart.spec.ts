// Wall art (0.9.0): placement offers the image row; upload flows through
// the browser adapter (file input) → ingest → store; remove clears it.
// Promoted from the M3 probe. The 3D texture render is covered by the
// manual rig pass — WebGL pixel checks don't belong in the functional suite.
import { writeFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { drawRoom, placeFurniture } from './helpers'

test('wall art upload and remove flow', async ({ page }, testInfo) => {
  await page.goto('/')
  await drawRoom(page)
  await placeFurniture(page, 'Framed art, portrait', 0.5, 0.4)

  // placement leaves the piece selected; image-capable items offer Upload
  const upload = page.locator('.props-panel button', { hasText: 'Upload…' })
  await expect(upload).toBeVisible()

  // paint a test image in-page and hand it to the file chooser
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 300
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#e63946'
    ctx.fillRect(0, 0, 400, 300)
    return c.toDataURL('image/png')
  })
  const file = testInfo.outputPath('upload.png')
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1]!, 'base64'))
  const chooser = page.waitForEvent('filechooser')
  await upload.click()
  await (await chooser).setFiles(file)

  // asset landed: Upload… becomes Replace… + Remove
  await expect(page.locator('.props-panel button', { hasText: 'Replace…' })).toBeVisible()
  const remove = page.locator('.props-panel button', { hasText: 'Remove' })
  await expect(remove).toBeVisible()

  // remove clears back to the upload state
  await remove.click()
  await expect(upload).toBeVisible()
  await expect(page.locator('.props-panel button', { hasText: 'Replace…' })).toHaveCount(0)
})
