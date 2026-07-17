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

/**
 * Currency display (0.9.0 cost tracking). Prices are unit-less numbers in
 * the document; only the DISPLAY dresses them in the device-pref symbol.
 * `suffix` follows each currency's convention (1 234.50 € vs $1 234.50).
 */
export interface CurrencySpec {
  id: string
  symbol: string
  suffix: boolean
}

export const CURRENCIES: CurrencySpec[] = [
  { id: 'eur', symbol: '€', suffix: true },
  { id: 'usd', symbol: '$', suffix: false },
  { id: 'gbp', symbol: '£', suffix: false },
  { id: 'kr', symbol: 'kr', suffix: true },
  { id: 'none', symbol: '', suffix: true },
]

export const currencySpec = (id: string): CurrencySpec =>
  CURRENCIES.find((c) => c.id === id) ?? CURRENCIES[CURRENCIES.length - 1]!

/** Deterministic (locale-free): space thousands grouping, '.' decimals,
 * two decimals only when fractional. */
export function formatCurrency(value: number, currencyId: string): string {
  const spec = currencySpec(currencyId)
  const abs = Math.abs(value)
  const fixed = Number.isInteger(abs) ? String(abs) : abs.toFixed(2)
  const [int, frac] = fixed.split('.')
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const num = `${value < 0 ? '−' : ''}${grouped}${frac ? `.${frac}` : ''}`
  if (!spec.symbol) return num
  return spec.suffix ? `${num} ${spec.symbol}` : `${spec.symbol}${num}`
}
