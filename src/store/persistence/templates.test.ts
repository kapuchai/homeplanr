import { beforeEach, describe, expect, it } from 'vitest'
import { TEMPLATES } from '../../app/templates'
import { parseDocument } from './serialize'
import { SCHEMA_VERSION, emptyDocument } from '../../model/types'
import { newProjectId } from '../../model/ids'
import { CATALOG } from '../../catalog'
import { newFromTemplate, usePersistStore } from './controller'
import { useDocStore } from '../docStore'
import { clearHistory, canUndo } from '../transactions'
import type { StorageAdapter } from './adapter'

// unit env is node — back localStorage (recovery blob) with a Map
const backing = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: () => null,
    get length() {
      return backing.size
    },
  },
})

/**
 * Bundled templates (M6, 0.4.0) must behave like pristine current-version
 * documents, and newFromTemplate must mirror newProject's state matrix.
 * Regenerate via scripts/makeTemplates.ts at every schema bump.
 */
describe('bundled template plans', () => {
  it('both templates parse at the current schema with healed=false, zero warnings', () => {
    expect(TEMPLATES).toHaveLength(2)
    for (const t of TEMPLATES) {
      const { doc, warnings, healed } = parseDocument(t.raw)
      expect(healed, t.id).toBe(false)
      expect(warnings, t.id).toEqual([])
      expect(doc.schemaVersion, t.id).toBe(SCHEMA_VERSION)
    }
  })

  it('templates carry real content: rooms named + floored, known furniture, doors and windows', () => {
    for (const t of TEMPLATES) {
      const { doc } = parseDocument(t.raw)
      const rooms = Object.values(doc.levels[0]!.rooms)
      expect(rooms.length, t.id).toBeGreaterThanOrEqual(2)
      for (const r of rooms) {
        expect(r.name, `${t.id}: unnamed room`).toBeTruthy()
        expect(r.floorMaterialId, `${t.id}: unfloored room`).toBeTruthy()
      }
      const items = Object.values(doc.levels[0]!.furniture)
      expect(items.length, t.id).toBeGreaterThanOrEqual(10)
      for (const f of items) {
        expect(CATALOG[f.catalogItemId], `${t.id}: unknown item ${f.catalogItemId}`).toBeDefined()
      }
      const openings = Object.values(doc.levels[0]!.openings)
      expect(openings.some((o) => o.kind === 'door'), t.id).toBe(true)
      expect(openings.some((o) => o.kind === 'window'), t.id).toBe(true)
    }
  })
})

describe('newFromTemplate — the newProject state matrix', () => {
  const adapter: StorageAdapter = {
    kind: 'tauri',
    async openImageDialog() {
      return null
    },
    async openDialog() {
      return null
    },
    async readPath() {
      throw new Error('unused')
    },
    async saveAsDialog() {
      return null
    },
    async saveBinaryDialog() {
      return null
    },
    setTitle() {},
    installCloseGuard() {},
    async message() {},
  }

  beforeEach(() => {
    useDocStore.setState({
      doc: emptyDocument(newProjectId(), 'test', '2026-07-16T00:00:00.000Z'),
    })
    clearHistory()
    usePersistStore.setState({
      adapter,
      currentFilePath: '/somewhere/old.homeplanr',
      lastSavedDoc: useDocStore.getState().doc,
      dirty: false,
      recents: [],
    })
  })

  it('fresh id + display name per instantiation; path null; clean; empty history', async () => {
    const t = TEMPLATES[0]!
    await newFromTemplate(t.name, t.raw)
    const first = useDocStore.getState().doc
    expect(first.name).toBe(t.name)
    expect(usePersistStore.getState().currentFilePath).toBeNull()
    expect(usePersistStore.getState().dirty).toBe(false)
    expect(canUndo()).toBe(false)
    expect(Object.keys(first.levels[0]!.furniture).length).toBeGreaterThanOrEqual(10)

    await newFromTemplate(t.name, t.raw)
    const second = useDocStore.getState().doc
    expect(second.id).not.toBe(first.id) // re-minted per instantiation
    expect(second.id).not.toBe(parseDocument(t.raw).doc.id)
  })
})
