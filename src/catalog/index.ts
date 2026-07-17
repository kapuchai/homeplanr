import type { CatalogCategory, CatalogItem } from './types'
import { STARTER_ITEMS } from './items/starter'
import { LIVING_ITEMS } from './items/living'
import { MORE_ITEMS } from './items/more'
import { EXPANSION_ITEMS } from './items/expansion'
import { DECOR_ITEMS } from './items/decor'
import { KITCHEN_ITEMS } from './items/kitchen'

export type { CatalogItem, CatalogCategory, Dims, SymbolPrim, MaterialId } from './types'

const ALL: CatalogItem[] = [
  ...STARTER_ITEMS,
  ...LIVING_ITEMS,
  ...MORE_ITEMS,
  ...EXPANSION_ITEMS,
  ...DECOR_ITEMS,
  ...KITCHEN_ITEMS,
]

export const CATALOG: Record<string, CatalogItem> = Object.fromEntries(
  ALL.map((item) => [item.id, item]),
)

export const CATEGORY_ORDER: CatalogCategory[] = [
  'living',
  'bedroom',
  'dining',
  'kitchen',
  'bathroom',
  'office',
  'decor',
]

export const CATALOG_BY_CATEGORY: Record<CatalogCategory, CatalogItem[]> = {
  living: [],
  bedroom: [],
  dining: [],
  kitchen: [],
  bathroom: [],
  office: [],
  decor: [],
}
for (const item of ALL) CATALOG_BY_CATEGORY[item.category].push(item)
