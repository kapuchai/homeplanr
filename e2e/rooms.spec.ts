import { expect, test } from '@playwright/test'
import { canvasPoint, drawRoom } from './helpers'

/**
 * Room rig gestures (0.8.0): click-then-drag moves a room; dropping it
 * against a neighbor welds edge-to-edge; R rotates the sole-selected room.
 * Promoted from the M1–M4 probe.
 */

const ROOM_A: readonly (readonly [number, number])[] = [
  [0.15, 0.3],
  [0.35, 0.3],
  [0.35, 0.6],
  [0.15, 0.6],
]
const ROOM_B: readonly (readonly [number, number])[] = [
  [0.5, 0.32],
  [0.7, 0.32],
  [0.7, 0.62],
  [0.5, 0.62],
]

test('click-then-drag moves a room and welds it against a neighbor', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page, { exact: true, corners: ROOM_A })
  await drawRoom(page, { exact: true, corners: ROOM_B })

  // click #1 selects room B (props panel shows the Room editor)
  const bCenter = await canvasPoint(page, 0.6, 0.47)
  await page.mouse.click(bCenter.x, bCenter.y)
  await expect(page.locator('.props-panel h3')).toHaveText('Room')

  // drag #2 moves it toward A; the corner snap makes the release weld
  const dock = await canvasPoint(page, 0.452, 0.452)
  await page.mouse.move(bCenter.x, bCenter.y)
  await page.mouse.down()
  await page.mouse.move(bCenter.x - 40, bCenter.y - 5, { steps: 5 })
  await page.mouse.move(dock.x, dock.y, { steps: 12 })
  await page.mouse.up()

  // both rooms alive after the weld, selection kept on the moved room
  const canvas = page.locator('svg.editor-canvas')
  await expect(canvas.locator('text').filter({ hasText: 'm²' })).toHaveCount(2)
  await expect(page.locator('.props-panel h3')).toHaveText('Room')

  // undo restores the pre-drag layout without dropping a room
  await page.keyboard.press('Control+z')
  await expect(canvas.locator('text').filter({ hasText: 'm²' })).toHaveCount(2)
})

test('R rotates the sole-selected room as one undo entry', async ({ page }) => {
  await page.goto('/')
  await drawRoom(page, { exact: true, corners: ROOM_A })
  const center = await canvasPoint(page, 0.25, 0.45)
  await page.mouse.click(center.x, center.y)
  await expect(page.locator('.props-panel h3')).toHaveText('Room')
  await page.keyboard.press('r')
  const canvas = page.locator('svg.editor-canvas')
  await expect(canvas.locator('text').filter({ hasText: 'm²' })).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(canvas.locator('text').filter({ hasText: 'm²' })).toHaveCount(1)
  await expect(page.locator('.props-panel h3')).toHaveText('Room') // selection survives
})
