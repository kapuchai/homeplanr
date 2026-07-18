import { DEFAULTS as MODEL_DEFAULTS, type LevelDoc } from '../model/types'
import type { LevelId } from '../model/ids'
import type { DerivedGeometry } from '../store/derived'
import type { Bounds } from '../geometry/polygon'
import {
  area as polygonArea,
  centroid as polygonCentroid,
  polygonBounds,
} from '../geometry/polygon'
import { docContentBounds } from '../editor2d/render/bounds'
import {
  arcPath,
  furnitureTransform,
  openingSymbol,
  polyPath,
  roomFill,
  roomLabelLines,
  type Line,
} from '../editor2d/render/planGeometry'
import { dimensionLabels, openingWidthLabels } from '../editor2d/measure/liveMeasurements'
import { CATALOG } from '../catalog'
import { symbolFor } from '../catalog/symbolFromParts'
import type { SymbolPrim } from '../catalog/types'
import { getTheme2d, type Theme2D } from '../theme/theme2d'
import { formatArea, formatLength } from '../format/units'
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
  /** Which storey to export (v7) — consumed by the export CONTROLLER when
   * resolving the level view; absent = the active floor. The pure SVG
   * renderer itself never reads it. */
  levelId?: LevelId
  /** Draw the document grid under the plan. Default false. */
  includeGrid?: boolean
  /** Paper margin around the content bounds, meters. Default 0.5. */
  marginM?: number
  /**
   * Fixed print scale 1:N — the SVG's width/height become REAL MILLIMETERS
   * (1m of plan = 1000/N mm on paper; the meter-space viewBox is unchanged).
   * Absent = fit-to-pixels sizing via exportPixelSize.
   */
  scaleDenominator?: number
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
// dashed opening ink ≈ the editor's "4 3" px pattern at nominal zoom
const INK_DASH = '0.04 0.03'
// 'NotoSans' is the family exportController registers with jsPDF — svg2pdf
// matches it for true-vector text with Cyrillic (B6). Browsers/viewers
// don't know it and fall through to system-ui (SVG + PNG output unchanged).
const FONT = 'NotoSans, system-ui, sans-serif'
const NAME_SIZE = 0.11
const AREA_SIZE = 0.1
const TYPE_SIZE = 0.09
const DIM_SIZE = 0.1

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!)

const lineEl = (l: Line, stroke: string, width: number, dash?: string): string =>
  `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`

/** Serialize one catalog symbol prim with SymbolRenderer's role styling. */
function primEl(p: SymbolPrim, theme: Theme2D): string {
  // silhouette: 2× hairline under the body fills — inside the flattened
  // footprint group the fills cover everything interior to the part union,
  // leaving a hairline border along the union boundary (see SymbolRenderer,
  // the styling twin this must stay in agreement with)
  const style =
    p.role === 'silhouette'
      ? `fill="none" stroke="${theme.symbolLine}" stroke-width="${HAIRLINE * 2}"`
      : p.role === 'body'
        ? `fill="${theme.symbolBody}" stroke="none"`
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
  doc: LevelDoc,
  derived: DerivedGeometry,
  opts: ExportPlanOptions = {},
): string | null {
  const margin = opts.marginM ?? EXPORT_MARGIN_M
  const bounds = polygonBounds(docContentBounds(doc, derived))
  if (!bounds) return null
  // print-friendly: ALWAYS light, regardless of app theme; only
  // accent-independent tokens are used so the accent choice cannot leak in
  const theme = getTheme2d('light', 'blue')
  const { units, dimensionLevel } = useAppSettings.getState()

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
      // ink emitter — the export-side styling twin of OpeningInkGlyph
      // (keep the two in agreement): lines at hairline, swing arcs at
      // detail, dashed roles dashed
      for (const prim of sym.ink) {
        if (prim.kind === 'line') {
          symbols.push(
            lineEl(prim.line, theme.text, HAIRLINE, prim.dashed ? INK_DASH : undefined),
          )
        } else {
          symbols.push(
            `<path d="${arcPath(prim.arc)}" fill="none" stroke="${theme.text}" stroke-width="${DETAIL}"/>`,
          )
        }
      }
    }
  }
  parts.push(...covers, ...symbols)

  // furniture symbols — the shared furnitureTransform keeps this, the
  // editor (WorldLayers), and the placement ghost pixel-identical
  for (const f of Object.values(doc.furniture)) {
    const item = CATALOG[f.catalogItemId]
    const allPrims = item ? symbolFor(item) : []
    // footprint layer flattened as ONE group (mirrors SymbolRenderer): part
    // fills never double-darken, silhouette strokes survive only on the
    // union boundary
    const footprint = allPrims.filter((p) => p.role === 'silhouette' || p.role === 'body')
    const strokes = allPrims.filter((p) => p.role === 'outline' || p.role === 'detail')
    const prims =
      `<g opacity="0.92">${footprint.map((p) => primEl(p, theme)).join('')}</g>` +
      strokes.map((p) => primEl(p, theme)).join('')
    const inner = item
      ? `<g transform="scale(${f.size.w / item.dims.w} ${f.size.d / item.dims.d})">${prims}</g>`
      : `<rect x="${-f.size.w / 2}" y="${-f.size.d / 2}" width="${f.size.w}" height="${f.size.d}" fill="${theme.symbolBody}" fill-opacity="0.9" stroke="${theme.invalid}" stroke-width="${HAIRLINE}" stroke-dasharray="0.04 0.03"/>`
    parts.push(`<g transform="${furnitureTransform(f.x, f.y, f.rotation, f.mirrored)}">${inner}</g>`)
  }

  // labels counter-flip (scale(1 -1)) so text reads upright in the y-up view
  for (const r of Object.values(derived.rooms)) {
    // title/type lines shared with WorldLayers (styling twins — planGeometry)
    const { title, typeLine } = roomLabelLines(r.room)
    parts.push(
      `<g transform="translate(${r.labelAnchor.x} ${r.labelAnchor.y}) scale(1 -1)">` +
        `<text text-anchor="middle" font-family="${FONT}" font-size="${NAME_SIZE}" font-weight="500" fill="${theme.text}">${esc(title)}</text>` +
        `<text text-anchor="middle" y="0.13" font-family="${FONT}" font-size="${AREA_SIZE}" fill="${theme.textMuted}">${esc(formatArea(r.areaM2, units))}</text>` +
        (typeLine
          ? `<text text-anchor="middle" y="0.25" font-family="${FONT}" font-size="${TYPE_SIZE}" fill="${theme.textMuted}">${esc(typeLine)}</text>`
          : '') +
        `</g>`,
    )
  }
  // user annotations — document content: ALWAYS exported (unlike the
  // dimension-ladder labels below)
  for (const ann of Object.values(doc.annotations)) {
    if (ann.kind === 'dimension') {
      const dx = ann.b.x - ann.a.x
      const dy = ann.b.y - ann.a.y
      const len = Math.hypot(dx, dy)
      if (len < 1e-9) continue
      const nx = (-dy / len) * ann.offset
      const ny = (dx / len) * ann.offset
      const p = { x: ann.a.x + nx, y: ann.a.y + ny }
      const q = { x: ann.b.x + nx, y: ann.b.y + ny }
      const tx2 = (-dy / len) * 0.04
      const ty2 = (dx / len) * 0.04
      const dim: string[] = []
      if (ann.offset !== 0) {
        dim.push(
          `<line x1="${ann.a.x}" y1="${ann.a.y}" x2="${p.x}" y2="${p.y}" stroke="${theme.textMuted}" stroke-width="${DETAIL}" stroke-dasharray="0.02 0.03"/>`,
          `<line x1="${ann.b.x}" y1="${ann.b.y}" x2="${q.x}" y2="${q.y}" stroke="${theme.textMuted}" stroke-width="${DETAIL}" stroke-dasharray="0.02 0.03"/>`,
        )
      }
      dim.push(
        `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${theme.textMuted}" stroke-width="${HAIRLINE}"/>`,
        `<line x1="${p.x - tx2}" y1="${p.y - ty2}" x2="${p.x + tx2}" y2="${p.y + ty2}" stroke="${theme.textMuted}" stroke-width="${HAIRLINE}"/>`,
        `<line x1="${q.x - tx2}" y1="${q.y - ty2}" x2="${q.x + tx2}" y2="${q.y + ty2}" stroke="${theme.textMuted}" stroke-width="${HAIRLINE}"/>`,
      )
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
      dim.push(
        `<g transform="translate(${mid.x} ${mid.y}) scale(1 -1)">` +
          `<text text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="${DIM_SIZE}" fill="${theme.text}" stroke="${theme.paper}" stroke-width="0.03" paint-order="stroke">${esc(formatLength(len, units))}</text>` +
          `</g>`,
      )
      parts.push(...dim)
    } else if (ann.kind === 'area') {
      // area text derived here exactly like the editor layer (shoelace +
      // current units — never stored)
      const c = polygonCentroid(ann.points)
      parts.push(
        `<path d="M ${ann.points.map((p) => `${p.x} ${p.y}`).join(' L ')} Z" fill="${theme.textMuted}" fill-opacity="0.08" stroke="${theme.textMuted}" stroke-width="${HAIRLINE}" stroke-dasharray="0.04 0.03"/>`,
        `<g transform="translate(${c.x} ${c.y}) scale(1 -1)">` +
          `<text text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="${DIM_SIZE}" fill="${theme.text}" stroke="${theme.paper}" stroke-width="0.03" paint-order="stroke">${esc(formatArea(polygonArea(ann.points), units))}</text>` +
          `</g>`,
      )
    } else {
      const size = ann.fontSize ?? MODEL_DEFAULTS.labelFontSize
      const deg = ((ann.rotation ?? 0) * 180) / Math.PI
      parts.push(
        `<g transform="translate(${ann.x} ${ann.y}) rotate(${deg}) scale(1 -1)">` +
          `<text text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="${size}" font-weight="500" fill="${theme.text}">${esc(ann.text)}</text>` +
          `</g>`,
      )
    }
  }

  // permanent dimension ladder (0.7.0): walls at ≥'walls', opening widths at
  // ≥'openings'; the 'all' furniture-size pills are selection-dependent and
  // deliberately never export
  if (dimensionLevel !== 'off') {
    const dimText = (at: { x: number; y: number }, text: string): string =>
      `<g transform="translate(${at.x} ${at.y}) scale(1 -1)">` +
      `<text text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="${DIM_SIZE}" fill="${theme.text}" stroke="${theme.paper}" stroke-width="0.03" paint-order="stroke">${esc(text)}</text>` +
      `</g>`
    for (const l of dimensionLabels(doc, derived, units, 1 / NOMINAL_PX_PER_M)) {
      parts.push(dimText(l.at, l.text))
    }
    if (dimensionLevel !== 'walls') {
      for (const l of openingWidthLabels(doc, derived, units, 1 / NOMINAL_PX_PER_M)) {
        parts.push(dimText(l.at, l.text))
      }
    }
  }

  // fixed scale → physical mm size (true 1:N when printed at 100%);
  // fit → the nominal pixel size as before
  const denom = opts.scaleDenominator
  const mm = (m: number) => Math.round((m * 1000 * 100) / denom!) / 100
  const width = denom ? `${mm(vw)}mm` : String(px.w)
  const height = denom ? `${mm(vh)}mm` : String(px.h)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${-y1} ${vw} ${vh}" width="${width}" height="${height}">` +
    `<rect x="${x0}" y="${-y1}" width="${vw}" height="${vh}" fill="${theme.paper}"/>` +
    `<g transform="scale(1 -1)">${parts.join('')}</g>` +
    `</svg>`
  )
}
