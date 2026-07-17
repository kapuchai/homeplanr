import { describe, expect, it } from 'vitest'
import { coverTransform } from './artTexture'

describe('coverTransform (object-fit: cover)', () => {
  it('wider asset than face: crops width, centered', () => {
    const t = coverTransform(2000, 1000, 1, 1)
    expect(t.repeatX).toBeCloseTo(0.5)
    expect(t.repeatY).toBe(1)
    expect(t.offsetX).toBeCloseTo(0.25)
    expect(t.offsetY).toBe(0)
  })

  it('taller asset than face: crops height, centered', () => {
    const t = coverTransform(1000, 2000, 1, 1)
    expect(t.repeatX).toBe(1)
    expect(t.repeatY).toBeCloseTo(0.5)
    expect(t.offsetX).toBe(0)
    expect(t.offsetY).toBeCloseTo(0.25)
  })

  it('matching aspect: full image, no offset', () => {
    const t = coverTransform(1600, 800, 1.2, 0.6)
    expect(t.repeatX).toBeCloseTo(1)
    expect(t.repeatY).toBeCloseTo(1)
    expect(t.offsetX).toBeCloseTo(0)
    expect(t.offsetY).toBeCloseTo(0)
  })

  it('portrait art face with landscape photo', () => {
    // face 0.5×0.7 (portrait), photo 4:3 (landscape) → heavy width crop
    const t = coverTransform(4000, 3000, 0.5, 0.7)
    expect(t.repeatY).toBe(1)
    expect(t.repeatX).toBeCloseTo(0.5 / 0.7 / (4 / 3))
    expect(t.offsetX).toBeCloseTo((1 - t.repeatX) / 2)
  })
})
