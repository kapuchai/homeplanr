import { CATALOG } from './index'
import type { CatalogItem } from './types'

/**
 * Catalog search (0.9.0). Synonyms live in ONE table keyed by item id —
 * not on CatalogItem — so the whole vocabulary is auditable at a glance,
 * and the completeness test (search.test.ts) forces an entry for every
 * item: a new item can't silently ship unfindable. English only by
 * decision (locale/RU dropped from the roadmap 0.6.0); lowercase.
 */
export const KEYWORDS: Record<string, readonly string[]> = {
  // living
  'sofa-3': ['couch', 'settee', 'lounge'],
  'sofa-2': ['couch', 'loveseat', 'settee'],
  'sofa-corner': ['couch', 'sectional', 'l-shaped'],
  armchair: ['lounge', 'reading', 'seat'],
  'coffee-table': ['living', 'lounge'],
  'tv-stand': ['television', 'media', 'console'],
  'tv-wall': ['television', 'screen', 'media'],
  bookshelf: ['shelving', 'library', 'storage'],
  'floor-lamp': ['light', 'lighting'],
  'table-lamp': ['light', 'lighting', 'desk'],
  plant: ['flower', 'greenery', 'pot'],
  rug: ['carpet', 'mat'],
  'side-table': ['end', 'small'],
  // bedroom
  'bed-double': ['queen', 'king', 'mattress'],
  'bed-single': ['twin', 'mattress'],
  wardrobe: ['closet', 'armoire', 'clothes', 'storage'],
  nightstand: ['bedside', 'table'],
  dresser: ['drawers', 'chest', 'commode', 'storage'],
  // dining
  'dining-table': ['kitchen'],
  'dining-table-round': ['kitchen'],
  'dining-chair': ['seat'],
  'bar-stool': ['seat', 'counter', 'high'],
  // kitchen
  'kitchen-counter': ['worktop', 'cabinet', 'cupboard'],
  'counter-30': ['worktop', 'cabinet', 'cupboard', 'module'],
  'counter-60': ['worktop', 'cabinet', 'cupboard', 'module'],
  'counter-90': ['worktop', 'cabinet', 'cupboard', 'module'],
  'counter-120': ['worktop', 'cabinet', 'cupboard', 'module'],
  'counter-corner': ['worktop', 'cabinet', 'l-shaped'],
  'counter-sink': ['basin', 'worktop', 'faucet', 'tap'],
  'counter-cooktop': ['stove', 'hob', 'cooker', 'burner', 'worktop'],
  fridge: ['refrigerator', 'freezer'],
  stove: ['oven', 'cooker', 'range', 'hob'],
  'kitchen-sink': ['basin', 'faucet', 'tap'],
  'kitchen-island': ['counter', 'worktop', 'bar'],
  'wall-cabinet': ['cupboard', 'storage', 'upper'],
  // bathroom
  toilet: ['wc', 'lavatory', 'loo'],
  bathtub: ['soaking'],
  washbasin: ['sink', 'vanity'],
  shower: ['cabin', 'stall'],
  'washing-machine': ['washer', 'laundry'],
  // office
  desk: ['table', 'workspace', 'work'],
  'desk-chair': ['swivel', 'computer', 'seat'],
  'filing-cabinet': ['drawers', 'storage', 'files'],
  // decor
  'art-portrait': ['picture', 'painting', 'poster', 'artwork', 'photo'],
  'art-landscape': ['picture', 'painting', 'poster', 'artwork', 'photo'],
  'art-square': ['picture', 'painting', 'poster', 'frame', 'artwork', 'photo'],
  curtain: ['drapes', 'window', 'fabric'],
  blinds: ['shades', 'window', 'venetian'],
  'mirror-wall': ['glass', 'reflection'],
  'mirror-full': ['glass', 'dressing', 'reflection'],
  'ceiling-lamp': ['light', 'lighting', 'pendant'],
  'wall-sconce': ['light', 'lighting', 'lamp'],
}

/**
 * Ranked search: name-prefix > name-substring > keyword > category.
 * Ties break alphabetically so results are stable.
 */
export function searchCatalog(query: string): CatalogItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { item: CatalogItem; score: number }[] = []
  for (const item of Object.values(CATALOG)) {
    const name = item.name.toLowerCase()
    let score: number | null = null
    if (name.startsWith(q)) score = 0
    else if (name.includes(q)) score = 1
    else if ((KEYWORDS[item.id] ?? []).some((k) => k.includes(q))) score = 2
    else if (item.category.includes(q)) score = 3
    if (score !== null) scored.push({ item, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .map((s) => s.item)
}
