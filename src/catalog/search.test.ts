import { describe, expect, it } from 'vitest'
import { CATALOG } from './index'
import { KEYWORDS, searchCatalog } from './search'

describe('keyword table completeness (the authoring oracle)', () => {
  it('every catalog item has a keyword entry; no stale entries linger', () => {
    for (const id of Object.keys(CATALOG)) {
      expect(KEYWORDS[id], `missing keywords for '${id}'`).toBeDefined()
    }
    for (const id of Object.keys(KEYWORDS)) {
      expect(CATALOG[id], `stale keyword entry '${id}'`).toBeDefined()
    }
  })

  it('keywords are lowercase, non-empty, and never duplicate the item name', () => {
    for (const [id, words] of Object.entries(KEYWORDS)) {
      const name = CATALOG[id]!.name.toLowerCase()
      for (const w of words) {
        expect(w, `empty keyword on '${id}'`).toBeTruthy()
        expect(w).toBe(w.toLowerCase())
        expect(name.includes(w), `'${w}' is redundant on '${id}' (already in the name)`).toBe(
          false,
        )
      }
    }
  })
})

describe('searchCatalog ranking', () => {
  const ids = (q: string) => searchCatalog(q).map((i) => i.id)

  it('synonyms find their items', () => {
    expect(ids('couch')).toEqual(expect.arrayContaining(['sofa-3', 'sofa-2', 'sofa-corner']))
    expect(ids('refrigerator')).toContain('fridge')
    expect(ids('wc')).toContain('toilet')
    expect(ids('worktop')).toEqual(expect.arrayContaining(['kitchen-counter', 'counter-corner']))
    expect(ids('poster')).toEqual(
      expect.arrayContaining(['art-portrait', 'art-landscape', 'art-square']),
    )
  })

  it('name-prefix beats name-substring beats keyword', () => {
    const results = ids('so')
    // 'Sofa…' names are prefix hits and must lead
    expect(results[0]!.startsWith('sofa')).toBe(true)
    // keyword-only hit ranks after every name hit
    const couch = ids('cou')
    const firstKeywordOnly = couch.indexOf('sofa-3') // keyword 'couch'
    const namePrefix = couch.indexOf('counter-30') // name 'Counter, 30 cm'
    expect(namePrefix).toBeGreaterThanOrEqual(0)
    expect(firstKeywordOnly).toBeGreaterThan(namePrefix)
  })

  it('category still matches, ranked last; blank queries return nothing', () => {
    expect(ids('bathro')).toEqual(
      expect.arrayContaining(['toilet', 'bathtub', 'washbasin', 'shower']),
    )
    expect(searchCatalog('   ')).toEqual([])
    expect(searchCatalog('zzzznope')).toEqual([])
  })
})
