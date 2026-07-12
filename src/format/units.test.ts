import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  formatArea,
  formatLength,
  fromDisplayLength,
  lengthUnitLabel,
  toDisplayLength,
  type UnitSystem,
} from './units'

const ALL_UNITS: UnitSystem[] = ['m', 'cm', 'ftin']

describe('formatLength', () => {
  it('meters: two decimals with unit', () => {
    expect(formatLength(3.24, 'm')).toBe('3.24 m')
    expect(formatLength(0, 'm')).toBe('0.00 m')
    expect(formatLength(12.5, 'm')).toBe('12.50 m')
  })

  it('centimeters: whole cm', () => {
    expect(formatLength(3.24, 'cm')).toBe('324 cm')
    expect(formatLength(0.005, 'cm')).toBe('1 cm')
    expect(formatLength(0, 'cm')).toBe('0 cm')
  })

  it('feet-inches: primes with quarter-inch fractions', () => {
    expect(formatLength(3.24, 'ftin')).toBe('10′ 7½″')
    expect(formatLength(0.0254 * 10.25, 'ftin')).toBe('10¼″')
    expect(formatLength(0.0254 * 7.75, 'ftin')).toBe('7¾″')
  })

  it('feet-inches: 11.99″ carries into 1′', () => {
    expect(formatLength(0.3047, 'ftin')).toBe('1′')
    expect(formatLength(0.3048, 'ftin')).toBe('1′')
  })

  it('feet-inches: collapses zero feet, zero inches, and both-zero', () => {
    expect(formatLength(0.1905, 'ftin')).toBe('7½″') // zero feet
    expect(formatLength(3.048, 'ftin')).toBe('10′') // zero inches
    expect(formatLength(0, 'ftin')).toBe('0″')
    expect(formatLength(0.002, 'ftin')).toBe('0″') // rounds to zero quarters
  })

  it('feet-inches: fraction-only inch part after whole feet', () => {
    expect(formatLength(0.3048 + 0.0254 * 0.5, 'ftin')).toBe('1′ ½″')
  })

  it('negatives: minus sign + absolute value', () => {
    expect(formatLength(-3.24, 'ftin')).toBe('−10′ 7½″')
    expect(formatLength(-0.002, 'ftin')).toBe('0″') // no signed zero
  })
})

describe('formatArea', () => {
  it('metric is ALWAYS m² — even in cm mode', () => {
    expect(formatArea(12.34, 'm')).toBe('12.3 m²')
    expect(formatArea(12.34, 'cm')).toBe('12.3 m²')
  })

  it('ftin converts to ft²', () => {
    expect(formatArea(10, 'ftin')).toBe('107.6 ft²')
    expect(formatArea(0, 'ftin')).toBe('0.0 ft²')
  })
})

describe('display length conversions', () => {
  it('converts meters to the display unit', () => {
    expect(toDisplayLength(2, 'm')).toBe(2)
    expect(toDisplayLength(2, 'cm')).toBe(200)
    expect(toDisplayLength(0.3048, 'ftin')).toBeCloseTo(1, 12)
  })

  it('converts display values back to meters', () => {
    expect(fromDisplayLength(2, 'm')).toBe(2)
    expect(fromDisplayLength(200, 'cm')).toBe(2)
    expect(fromDisplayLength(1, 'ftin')).toBeCloseTo(0.3048, 12)
  })

  it('labels each unit', () => {
    expect(lengthUnitLabel('m')).toBe('m')
    expect(lengthUnitLabel('cm')).toBe('cm')
    expect(lengthUnitLabel('ftin')).toBe('ft')
  })

  it('property: fromDisplayLength(toDisplayLength(x, u), u) ≈ x', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.constantFrom(...ALL_UNITS),
        (x, u) => {
          expect(fromDisplayLength(toDisplayLength(x, u), u)).toBeCloseTo(x, 9)
        },
      ),
    )
  })
})
