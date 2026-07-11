import type { CatalogCategory, CatalogItem } from './types'
import { STARTER_ITEMS } from './items/starter'

export type { CatalogItem, CatalogCategory, Dims, SymbolPrim, MaterialId } from './types'

const ALL: CatalogItem[] = [...STARTER_ITEMS]

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
]

export const CATALOG_BY_CATEGORY: Record<CatalogCategory, CatalogItem[]> = {
  living: [],
  bedroom: [],
  dining: [],
  kitchen: [],
  bathroom: [],
  office: [],
}
for (const item of ALL) CATALOG_BY_CATEGORY[item.category].push(item)
