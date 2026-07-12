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
export type PatternKind = 'plank' | 'tile' | 'stone' | 'brick' | 'concrete'

const SIZE = 256

/** Meters of surface covered by one texture repeat. */
const TILE_METERS: Record<PatternKind, number> = {
  plank: 1.0,
  tile: 1.0,
  stone: 1.2,
  brick: 0.6,
  concrete: 1.0,
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

const DRAW: Record<PatternKind, (ctx: CanvasRenderingContext2D) => void> = {
  plank: drawPlank,
  tile: drawTile,
  stone: drawStone,
  brick: drawBrick,
  concrete: drawConcrete,
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
