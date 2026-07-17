import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'

/**
 * Procedural pattern textures — one cached 256² grayscale CanvasTexture per
 * kind. Deterministic by construction: every jitter comes from hash2()
 * (never Math.random), so two runs paint identical pixels. Tones stay in
 * mid-grays around #808080 neutrality; hue arrives via material.color
 * tinting, so ONE texture serves every color variant of a kind.
 *
 * UVs are meters (wall faces: (wall-local u, z); floors: world (x, y));
 * texture.repeat bakes 1/tileMeters so one canvas covers tileMeters of
 * surface. Node tests have no DOM: patternTexture returns (and caches)
 * null there — every consumer treats the map as optional.
 */
export type PatternKind =
  | 'plank'
  | 'tile'
  | 'stone'
  | 'brick'
  | 'concrete'
  | 'wallpaperStripe'
  | 'wallpaperDamask'
  | 'panel'
  | 'plaster'
  | 'herringbone'

const SIZE = 256

/** Meters of surface covered by one texture repeat. */
const TILE_METERS: Record<PatternKind, number> = {
  plank: 1.0,
  tile: 1.0,
  stone: 1.2,
  brick: 0.6,
  concrete: 1.0,
  wallpaperStripe: 0.6,
  wallpaperDamask: 0.6,
  panel: 0.5,
  plaster: 1.0,
  herringbone: 0.9,
}

/** Small integer hash → [0, 1) — the deterministic stand-in for Math.random. */
function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const gray = (l: number): string => {
  const v = Math.round(l)
  return `rgb(${v}, ${v}, ${v})`
}

const grayA = (l: number, a: number): string => {
  const v = Math.round(l)
  return `rgba(${v}, ${v}, ${v}, ${a})`
}

/** fillRect that wraps horizontally across the tile edge (seamless repeat). */
function fillRectWrapX(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const x0 = ((x % SIZE) + SIZE) % SIZE
  ctx.fillRect(x0, y, w, h)
  if (x0 + w > SIZE) ctx.fillRect(x0 - SIZE, y, w, h)
}

/** Soft radial blotches, redrawn at ±SIZE offsets where they cross an edge. */
function softBlotches(
  ctx: CanvasRenderingContext2D,
  seed: number,
  count: number,
  lumMin: number,
  lumSpan: number,
  alphaMin: number,
  alphaSpan: number,
  rMin: number,
  rSpan: number,
): void {
  for (let i = 0; i < count; i++) {
    const x = hash2(seed + i, 11) * SIZE
    const y = hash2(seed + i, 23) * SIZE
    const r = rMin + hash2(seed + i, 37) * rSpan
    const l = lumMin + hash2(seed + i, 53) * lumSpan
    const a = alphaMin + hash2(seed + i, 71) * alphaSpan
    for (const ox of [-SIZE, 0, SIZE]) {
      if (x + ox + r < 0 || x + ox - r > SIZE) continue
      for (const oy of [-SIZE, 0, SIZE]) {
        if (y + oy + r < 0 || y + oy - r > SIZE) continue
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r)
        g.addColorStop(0, grayA(l, a))
        g.addColorStop(1, grayA(l, 0))
        ctx.fillStyle = g
        ctx.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r)
      }
    }
  }
}

/** 0.125 m boards: long seams, staggered end joints, per-plank luminance. */
function drawPlank(ctx: CanvasRenderingContext2D): void {
  const row = SIZE / 8
  const half = SIZE / 2
  for (let r = 0; r < 8; r++) {
    const y = r * row
    const seam = Math.floor(hash2(r, 101) * SIZE)
    // two planks per row (the second wraps), individually jittered
    ctx.fillStyle = gray(120 + hash2(r, 1) * 22)
    ctx.fillRect(0, y, SIZE, row)
    ctx.fillStyle = gray(120 + hash2(r, 2) * 22)
    fillRectWrapX(ctx, seam, y, half, row)
    // long seam between rows + the two end joints
    ctx.fillStyle = gray(97)
    ctx.fillRect(0, y, SIZE, 1.5)
    fillRectWrapX(ctx, seam, y, 1.5, row)
    fillRectWrapX(ctx, seam + half, y, 1.5, row)
  }
}

/** 4 × 4 grid of 0.25 m tiles: grout lines, faint per-tile jitter. */
function drawTile(ctx: CanvasRenderingContext2D): void {
  const cell = SIZE / 4
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      ctx.fillStyle = gray(126 + hash2(i, j) * 12)
      ctx.fillRect(i * cell, j * cell, cell, cell)
    }
  }
  // grout centered on grid lines; the k=0 and k=4 halves meet at the seam
  ctx.fillStyle = gray(94)
  for (let k = 0; k <= 4; k++) {
    ctx.fillRect(k * cell - 1, 0, 2, SIZE)
    ctx.fillRect(0, k * cell - 1, SIZE, 2)
  }
}

/** Soft mottled stone. */
function drawStone(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = gray(128)
  ctx.fillRect(0, 0, SIZE, SIZE)
  softBlotches(ctx, 500, 42, 112, 34, 0.18, 0.2, 14, 34)
}

/** Running bond: 0.075 m courses of 0.24 m bricks, 2 px mortar joints. */
function drawBrick(ctx: CanvasRenderingContext2D): void {
  const course = SIZE * (0.075 / 0.6) // 32 px
  const brick = SIZE * (0.24 / 0.6) // 102.4 px
  const half = brick / 2
  ctx.fillStyle = gray(150) // mortar
  ctx.fillRect(0, 0, SIZE, SIZE)
  for (let r = 0; r < 8; r++) {
    const y = r * course
    // 0.6 m is 2.5 bricks, so joints are pinned to the repeat edge and each
    // course carries one 0.12 m closer — periodic across tiles by construction.
    const joints =
      r % 2 === 0 ? [0, brick, 2 * brick, SIZE] : [0, half, half + brick, SIZE]
    for (let b = 0; b + 1 < joints.length; b++) {
      const x0 = joints[b]!
      const x1 = joints[b + 1]!
      ctx.fillStyle = gray(116 + hash2(r, b) * 26)
      ctx.fillRect(x0 + 1, y + 1, x1 - x0 - 2, course - 2)
    }
  }
}

/** Low-contrast noise plus faint broad mottling. */
function drawConcrete(ctx: CanvasRenderingContext2D): void {
  const cell = 8
  const n = SIZE / cell
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = gray(122 + hash2(i, j) * 12)
      ctx.fillRect(i * cell, j * cell, cell, cell)
    }
  }
  softBlotches(ctx, 900, 8, 120, 16, 0.05, 0.07, 40, 60)
}

/** Subtle vertical stripes: 8 bands per 0.6 m + a fine pinstripe. The
 * pattern is y-invariant, so it is vertically seamless by construction. */
function drawWallpaperStripe(ctx: CanvasRenderingContext2D): void {
  const band = SIZE / 8
  for (let b = 0; b < 8; b++) {
    ctx.fillStyle = gray(b % 2 === 0 ? 130 : 123)
    ctx.fillRect(b * band, 0, band, SIZE)
    ctx.fillStyle = gray(114)
    ctx.fillRect(b * band, 0, 1.5, SIZE)
  }
}

/** Low-contrast damask read: diamond motifs on a diagonal checker (period
 * 2 cells in both axes — wraps by construction). */
function drawWallpaperDamask(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = gray(129)
  ctx.fillRect(0, 0, SIZE, SIZE)
  const cell = SIZE / 4
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if ((i + j) % 2 !== 0) continue
      const cx = i * cell + cell / 2
      const cy = j * cell + cell / 2
      const r = cell * 0.32
      ctx.strokeStyle = grayA(116, 0.8)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx, cy - r)
      ctx.lineTo(cx + r, cy)
      ctx.lineTo(cx, cy + r)
      ctx.lineTo(cx - r, cy)
      ctx.closePath()
      ctx.stroke()
      ctx.fillStyle = grayA(118, 0.85)
      ctx.beginPath()
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/** Vertical boards (0.125 m per board at 0.5 m tile): full-height panels
 * with a seam and a bevel highlight; y-invariant → vertically seamless. */
function drawPanel(ctx: CanvasRenderingContext2D): void {
  const board = SIZE / 4
  for (let b = 0; b < 4; b++) {
    ctx.fillStyle = gray(122 + hash2(b, 7) * 16)
    ctx.fillRect(b * board, 0, board, SIZE)
    ctx.fillStyle = gray(100) // seam
    ctx.fillRect(b * board, 0, 2, SIZE)
    ctx.fillStyle = grayA(142, 0.5) // bevel highlight beside the seam
    ctx.fillRect(b * board + 2, 0, 2, SIZE)
  }
}

/** Smooth plaster: fine low-contrast grain + very faint broad mottling. */
function drawPlaster(ctx: CanvasRenderingContext2D): void {
  const cell = 4
  const n = SIZE / cell
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = gray(125 + hash2(i + 300, j) * 7)
      ctx.fillRect(i * cell, j * cell, cell, cell)
    }
  }
  softBlotches(ctx, 1300, 5, 123, 10, 0.04, 0.05, 50, 70)
}

/** Chevron-herringbone parquet: 4 zigzag columns of 45° planks. Column
 * width 64 px, seam spacing 32 px; the per-column diagonal displacement is
 * a multiple of the spacing, so the pattern wraps on both axes. */
function drawHerringbone(ctx: CanvasRenderingContext2D): void {
  const col = SIZE / 4
  const seam = col / 2
  for (let c = 0; c < 4; c++) {
    const dir = c % 2 === 0 ? 1 : -1
    const x0 = c * col
    const x1 = x0 + col
    for (let s = -3; s < SIZE / seam + 3; s++) {
      const y0 = s * seam
      ctx.fillStyle = gray(118 + hash2(c, ((s % 8) + 8) % 8) * 22)
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y0 + dir * col)
      ctx.lineTo(x1, y0 + seam + dir * col)
      ctx.lineTo(x0, y0 + seam)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = gray(98)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y0 + dir * col)
      ctx.stroke()
    }
    // column seam
    ctx.fillStyle = gray(98)
    ctx.fillRect(x0, 0, 1.2, SIZE)
  }
}

const DRAW: Record<PatternKind, (ctx: CanvasRenderingContext2D) => void> = {
  plank: drawPlank,
  tile: drawTile,
  stone: drawStone,
  brick: drawBrick,
  concrete: drawConcrete,
  wallpaperStripe: drawWallpaperStripe,
  wallpaperDamask: drawWallpaperDamask,
  panel: drawPanel,
  plaster: drawPlaster,
  herringbone: drawHerringbone,
}

const cache = new Map<PatternKind, CanvasTexture | null>()

/**
 * The cached grayscale texture for a pattern kind, or null when canvas 2D
 * is unavailable (node tests, headless webviews). The null is cached too —
 * unavailability is permanent for the process.
 */
export function patternTexture(kind: PatternKind): CanvasTexture | null {
  if (cache.has(kind)) return cache.get(kind) ?? null
  const tex = createTexture(kind)
  cache.set(kind, tex)
  return tex
}

function createTexture(kind: PatternKind): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  DRAW[kind](ctx)
  const tex = new CanvasTexture(canvas)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  const tm = TILE_METERS[kind]
  tex.repeat.set(1 / tm, 1 / tm)
  return tex
}
