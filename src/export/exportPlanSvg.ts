import type { ProjectDocument } from '../model/types'
import type { DerivedGeometry } from '../store/derived'
import type { Bounds } from '../geometry/polygon'
import { polygonBounds } from '../geometry/polygon'
import { docContentBounds } from '../editor2d/render/bounds'
import { openingSymbol, polyPath, roomFill, type Line } from '../editor2d/render/planGeometry'
import { dimensionLabels } from '../editor2d/measure/liveMeasurements'
import { CATALOG } from '../catalog'
import { symbolFor } from '../catalog/symbolFromParts'
import type { SymbolPrim } from '../catalog/types'
import { getTheme2d, type Theme2D } from '../theme/theme2d'
import { formatArea } from '../format/units'
import { useAppSettings } from '../store/appSettings'

/**
 * Static SVG rendering of the 2D plan — the export twin of WorldLayers.
 * Same layer order, same geometry (planGeometry.ts), but print-oriented:
 * ALWAYS the light theme (accent-independent tokens only), physical stroke
 * widths instead of non-scaling hairlines, and no editor chrome (selection,
 * snaps, guides; grid is opt-in). One `scale(1 -1)` group flips the y-down
 * model into the y-up chirality the editor renders (viewportMath docblock).
 */
export interface ExportPlanOptions {
  /** Draw the document grid under the plan. Default false. */
  includeGrid?: boolean
  /** Paper margin around the content bounds, meters. Default 0.5. */
  marginM?: number
}

export const EXPORT_MARGIN_M = 0.5
/** Raster density the strokes/fonts are sized for (≈ editor at k=100). */
export const NOMINAL_PX_PER_M = 100
/** PNG renders at 2× the nominal pixel size for crisp hairlines. */
export const RASTER_SCALE = 2
const RASTER_MAX_PX = 4096
const RASTER_MIN_PX = 512

// physical stroke widths (m): hairline ≈ 1px, detail ≈ 0.8px at nominal zoom
const HAIRLINE = 0.01
const DETAIL = 0.008
const FONT = 'system-ui, sans-serif'
const NAME_SIZE = 0.11
const AREA_SIZE = 0.1
const DIM_SIZE = 0.1

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!)

const lineEl = (l: Line, stroke: string, width: number): string =>
  `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`

/** Serialize one catalog symbol prim with SymbolRenderer's role styling. */
function primEl(p: SymbolPrim, theme: Theme2D): string {
  const style =
    p.role === 'body'
      ? `fill="${theme.symbolBody}" fill-opacity="0.92" stroke="${theme.symbolLine}" stroke-width="${HAIRLINE}"`
      : p.role === 'outline'
        ? `fill="none" stroke="${theme.symbolLine}" stroke-width="${HAIRLINE}"`
        : `fill="none" stroke="${theme.symbolDetail}" stroke-width="${DETAIL}"`
  switch (p.kind) {
    case 'rect':
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"${p.rx !== undefined ? ` rx="${p.rx}"` : ''} ${style}/>`
    case 'line':
      return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" ${style}/>`
    case 'circle':
      return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" ${style}/>`
    case 'path':
      return `<path d="${p.d}" ${style}/>`
  }
}

/**
 * Logical pixel size for rasterizing the plan: nominal 100 px/m, scaled
 * down so the 2× raster stays ≤ 4096 px, up so tiny plans reach ≥ 512 px.
 */
export function exportPixelSize(
  bounds: Bounds,
  marginM: number,
): { w: number; h: number; k: number } {
  const wM = Math.max(bounds.maxX - bounds.minX + 2 * marginM, 1e-6)
  const hM = Math.max(bounds.maxY - bounds.minY + 2 * marginM, 1e-6)
  const maxM = Math.max(wM, hM)
  let k = NOMINAL_PX_PER_M
  if (maxM * k * RASTER_SCALE > RASTER_MAX_PX) k = RASTER_MAX_PX / (RASTER_SCALE * maxM)
  else if (maxM * k < RASTER_MIN_PX) k = RASTER_MIN_PX / maxM
  return { w: Math.max(1, Math.round(wM * k)), h: Math.max(1, Math.round(hM * k)), k }
}

/**
 * Render the whole plan as a standalone SVG string; null when the document
 * has no visible content. Deterministic for a given doc/derived/settings.
 */
export function renderPlanSvg(
  doc: ProjectDocument,
  derived: DerivedGeometry,
  opts: ExportPlanOptions = {},
): string | null {
  const margin = opts.marginM ?? EXPORT_MARGIN_M
  const bounds = polygonBounds(docContentBounds(doc, derived))
  if (!bounds) return null
  // print-friendly: ALWAYS light, regardless of app theme; only
  // accent-independent tokens are used so the accent choice cannot leak in
  const theme = getTheme2d('light', 'blue')
  const { units, showDimensions } = useAppSettings.getState()

  const x0 = bounds.minX - margin
  const y0 = bounds.minY - margin
  const x1 = bounds.maxX + margin
  const y1 = bounds.maxY + margin
  const vw = bounds.maxX - bounds.minX + 2 * margin
  const vh = bounds.maxY - bounds.minY + 2 * margin
  const px = exportPixelSize(bounds, margin)

  // everything below is authored in model space (y-down) inside the flip group
  const parts: string[] = []

  if (opts.includeGrid) {
    const g = doc.settings.gridSize
    if (g > 0) {
      const minor: string[] = []
      const major: string[] = []
      for (let i = Math.ceil(x0 / g); i * g <= x1; i++) {
        ;(i % 10 === 0 ? major : minor).push(`M ${i * g} ${y0} L ${i * g} ${y1}`)
      }
      for (let j = Math.ceil(y0 / g); j * g <= y1; j++) {
        ;(j % 10 === 0 ? major : minor).push(`M ${x0} ${j * g} L ${x1} ${j * g}`)
      }
      if (minor.length)
        parts.push(
          `<path d="${minor.join(' ')}" fill="none" stroke="${theme.gridMinor}" stroke-width="${DETAIL}"/>`,
        )
      if (major.length)
        parts.push(
          `<path d="${major.join(' ')}" fill="none" stroke="${theme.gridMajor}" stroke-width="${HAIRLINE}"/>`,
        )
    }
  }

  // room fills
  for (const r of Object.values(derived.rooms)) {
    parts.push(
      `<path d="${[polyPath(r.polygon), ...r.holePolygons.map(polyPath)].join(' ')}" fill-rule="evenodd" fill="${roomFill(r, theme)}" fill-opacity="0.6" stroke="none"/>`,
    )
  }

  // walls: ONE path incl. node patches
  const wallD = [
    ...Object.values(derived.outlines.wallPolygons).map(polyPath),
    ...Object.values(derived.outlines.nodePatches).map(polyPath),
  ].join(' ')
  if (wallD.trim())
    parts.push(`<path d="${wallD}" fill="${theme.wall}" fill-rule="nonzero" stroke="none"/>`)

  // opening covers (all under all symbols — same order as the editor layers)
  const covers: string[] = []
  const symbols: string[] = []
  for (const solid of Object.values(derived.wallSolids)) {
    const wall = doc.walls[solid.wallId]
    if (!wall) continue
    for (const op of solid.openings) {
      const model = doc.openings[op.openingId]
      if (!model) continue
      const sym = openingSymbol(solid, wall, op, model)
      covers.push(`<path d="${polyPath(sym.coverRect)}" fill="${theme.paper}" stroke="none"/>`)
      symbols.push(lineEl(sym.jambs[0], theme.text, HAIRLINE))
      symbols.push(lineEl(sym.jambs[1], theme.text, HAIRLINE))
      if (sym.windowLines) {
        for (const l of sym.windowLines) symbols.push(lineEl(l, theme.text, HAIRLINE))
      }
      if (sym.door) {
        const a = sym.door.arc
        symbols.push(lineEl(sym.door.leaf, theme.text, HAIRLINE))
        symbols.push(
          `<path d="M ${a.from.x} ${a.from.y} A ${a.r} ${a.r} 0 0 ${a.sweep} ${a.to.x} ${a.to.y}" fill="none" stroke="${theme.text}" stroke-width="${DETAIL}"/>`,
        )
      }
    }
  }
  parts.push(...covers, ...symbols)

  // furniture symbols — transform mirrors WorldLayers exactly (trailing
  // scale(-1 1) = reflection across item-local x=0 before the rotation)
  for (const f of Object.values(doc.furniture)) {
    const item = CATALOG[f.catalogItemId]
    const deg = (f.rotation * 180) / Math.PI
    const mirror = f.mirrored ? ' scale(-1 1)' : ''
    const prims = item ? symbolFor(item).map((p) => primEl(p, theme)).join('') : ''
    const inner = item
      ? `<g transform="scale(${f.size.w / item.dims.w} ${f.size.d / item.dims.d})">${prims}</g>`
      : `<rect x="${-f.size.w / 2}" y="${-f.size.d / 2}" width="${f.size.w}" height="${f.size.d}" fill="${theme.symbolBody}" fill-opacity="0.9" stroke="${theme.invalid}" stroke-width="${HAIRLINE}" stroke-dasharray="0.04 0.03"/>`
    parts.push(`<g transform="translate(${f.x} ${f.y}) rotate(${deg})${mirror}">${inner}</g>`)
  }

  // labels counter-flip (scale(1 -1)) so text reads upright in the y-up view
  for (const r of Object.values(derived.rooms)) {
    parts.push(
      `<g transform="translate(${r.labelAnchor.x} ${r.labelAnchor.y}) scale(1 -1)">` +
        `<text text-anchor="middle" font-family="${FONT}" font-size="${NAME_SIZE}" font-weight="500" fill="${theme.text}">${esc(r.room.name ?? 'Room')}</text>` +
        `<text text-anchor="middle" y="0.13" font-family="${FONT}" font-size="${AREA_SIZE}" fill="${theme.textMuted}">${esc(formatArea(r.areaM2, units))}</text>` +
        `</g>`,
    )
  }
  if (showDimensions) {
    for (const l of dimensionLabels(doc, derived, units, 1 / NOMINAL_PX_PER_M)) {
      parts.push(
        `<g transform="translate(${l.at.x} ${l.at.y}) scale(1 -1)">` +
          `<text text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="${DIM_SIZE}" fill="${theme.text}" stroke="${theme.paper}" stroke-width="0.03" paint-order="stroke">${esc(l.text)}</text>` +
          `</g>`,
      )
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${-y1} ${vw} ${vh}" width="${px.w}" height="${px.h}">` +
    `<rect x="${x0}" y="${-y1}" width="${vw}" height="${vh}" fill="${theme.paper}"/>` +
    `<g transform="scale(1 -1)">${parts.join('')}</g>` +
    `</svg>`
  )
}
