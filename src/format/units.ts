/**
 * Display-unit formatting — PURE (no store imports; appSettings imports the
 * UnitSystem type from here, never the reverse). Model space stays meters.
 */
export type UnitSystem = 'm' | 'cm' | 'ftin'

const QUARTER_GLYPHS = ['', '¼', '½', '¾'] as const

/** Feet/inches with quarter-inch rounding: 3.24 m → “10′ 7½″”. */
function formatFtIn(meters: number): string {
  const quarters = Math.round((Math.abs(meters) / 0.0254) * 4)
  if (quarters === 0) return '0″'
  const feet = Math.floor(quarters / 48)
  const wholeInches = Math.floor((quarters % 48) / 4)
  const frac = QUARTER_GLYPHS[quarters % 4]!
  const sign = meters < 0 ? '−' : ''
  const inchPart =
    quarters % 48 === 0 ? '' : wholeInches === 0 && frac ? `${frac}″` : `${wholeInches}${frac}″`
  if (feet === 0) return `${sign}${inchPart}`
  if (!inchPart) return `${sign}${feet}′`
  return `${sign}${feet}′ ${inchPart}`
}

export function formatLength(meters: number, units: UnitSystem): string {
  if (units === 'cm') return `${Math.round(meters * 100)} cm`
  if (units === 'ftin') return formatFtIn(meters)
  return `${meters.toFixed(2)} m`
}

/** Metric areas stay m² even in cm mode — cm² is unusable at room scale. */
export function formatArea(m2: number, units: UnitSystem): string {
  if (units === 'ftin') return `${(m2 * 10.7639).toFixed(1)} ft²`
  return `${m2.toFixed(1)} m²`
}

export function toDisplayLength(meters: number, units: UnitSystem): number {
  if (units === 'cm') return meters * 100
  if (units === 'ftin') return meters / 0.3048
  return meters
}

export function fromDisplayLength(value: number, units: UnitSystem): number {
  if (units === 'cm') return value / 100
  if (units === 'ftin') return value * 0.3048
  return value
}

export function lengthUnitLabel(units: UnitSystem): string {
  if (units === 'cm') return 'cm'
  if (units === 'ftin') return 'ft'
  return 'm'
}
