/**
 * Opening style registry (0.10.0) — Opening.style references these ids
 * (field shipped schema-only in v6). OPEN registry: unknown ids in
 * documents are preserved and render as the standard style — every
 * consumer resolves through openingStyleSpec, never by indexing a table
 * with a raw id. Display names are raw strings by the catalog convention
 * (rendered plan content, shared with the i18n-free SVG exporter — not
 * chrome).
 *
 * An absent `style` field IS the standard style; placement never writes
 * 'standard' and restyling back to it deletes the field.
 *
 * `defaults` seed width/height/sillHeight at PLACEMENT only — restyling
 * an existing opening keeps the user's dimensions. `restyleSill` is the
 * one structural exception: a style that only exists at a fixed sill
 * (full-height) forces it on restyle too.
 */
export interface OpeningStyleSpec {
  /** Stable id — persisted in documents; never rename. */
  id: string
  kind: 'door' | 'window'
  name: string
  /** Placement-time dimension seeds (absent field = the kind default). */
  defaults?: { width?: number; height?: number; sillHeight?: number }
  /** Sill forced when restyling an existing window. */
  restyleSill?: number
}

export const STANDARD_STYLE_ID = 'standard'

export const OPENING_STYLES: readonly OpeningStyleSpec[] = [
  // doors — standard first (the picker order)
  { id: 'standard', kind: 'door', name: 'Standard' },
  { id: 'sliding', kind: 'door', name: 'Sliding', defaults: { width: 1.2 } },
  { id: 'double', kind: 'door', name: 'Double', defaults: { width: 1.5 } },
  { id: 'balcony', kind: 'door', name: 'Balcony', defaults: { height: 2.1 } },
  { id: 'passage', kind: 'door', name: 'Passage', defaults: { width: 1.2 } },
  { id: 'garage', kind: 'door', name: 'Garage', defaults: { width: 2.4, height: 2.1 } },
  // windows — standard first
  { id: 'standard', kind: 'window', name: 'Standard' },
  {
    id: 'fullheight',
    kind: 'window',
    name: 'Full-height',
    defaults: { height: 2.2, sillHeight: 0 },
    restyleSill: 0,
  },
  {
    id: 'panorama',
    kind: 'window',
    name: 'Panorama',
    defaults: { width: 2.4, height: 1.4, sillHeight: 0.5 },
  },
  { id: 'arched', kind: 'window', name: 'Arched', defaults: { height: 1.4 } },
]

export const DOOR_STYLES: readonly OpeningStyleSpec[] = OPENING_STYLES.filter(
  (s) => s.kind === 'door',
)
export const WINDOW_STYLES: readonly OpeningStyleSpec[] = OPENING_STYLES.filter(
  (s) => s.kind === 'window',
)

export function openingStylesFor(kind: 'door' | 'window'): readonly OpeningStyleSpec[] {
  return kind === 'door' ? DOOR_STYLES : WINDOW_STYLES
}

/**
 * Style id → spec for the kind; unknown/absent ids resolve to the kind's
 * standard spec (never null — this IS the forward-compatible fallback).
 */
export function openingStyleSpec(
  kind: 'door' | 'window',
  id: string | undefined,
): OpeningStyleSpec {
  const styles = openingStylesFor(kind)
  return (id !== undefined && styles.find((s) => s.id === id)) || styles[0]!
}
