import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getActiveLevelDoc } from '../../store/levelView'
import { useDocStore, docTemporal } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { useConfirmStore } from '../../app/confirmStore'
import { usePersistStore } from '../../store/persistence/controller'
import type { StorageAdapter } from '../../store/persistence/adapter'
import { useInteractionStore } from '../session/interactionStore'
import { useViewportStore } from '../viewport/viewportStore'
import { screenToWorld } from '../viewport/viewportMath'
import { resetDerivedForTests } from '../../store/derived'
import { abortTx, beginTx as beginTxForTest, commitTx as commitTxForTest, clearHistory, isTxActive, safeUndo } from '../../store/transactions'
import { switchTool, toolContext, toolRegistry } from './toolRegistry'
import { clearClipboardForTests, hasClipboard } from '../clipboard'
import { handleKey, handleKeyUp, flushPendingNudge, type KeyInput } from './keymap'
import type { EditorPointerEvent } from './toolTypes'
import { emptyDocument } from '../../model/types'
import { newProjectId, type FurnitureId } from '../../model/ids'
import { vec, type Vec2 } from '../../geometry/vec'
import { area } from '../../geometry/polygon'
import { useAppSettings } from '../../store/appSettings'

/**
 * Tool state machines driven by scripted event sequences against the REAL
 * document store — the plan's M3a regression net. Runs on the app-shared
 * registry/context singletons: switchTool and the keymap must deactivate
 * the very instances these tests drive.
 */
const registry = toolRegistry
const ctx = toolContext

const past = () => docTemporal.getState().pastStates.length
const walls = () => Object.keys(getActiveLevelDoc().walls).length
const rooms = () => Object.keys(getActiveLevelDoc().rooms).length

const pe = (world: Vec2, mods: Partial<EditorPointerEvent['mods']> = {}, button = 0): EditorPointerEvent => ({
  world,
  // screen coords mirror world at k=100 for slop math (0.01 m/px)
  screen: { x: world.x * 100, y: world.y * 100 },
  mods: { shift: false, ctrl: false, alt: false, ...mods },
  button,
  pointerId: 1,
})

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  editableTarget: false,
  preventDefault: () => {},
  ...extra,
})

const tool = () => registry.get(useUiStore.getState().activeTool)
const click = (p: Vec2, mods?: Partial<EditorPointerEvent['mods']>) => {
  tool().onPointerDown(pe(p, mods), ctx)
  tool().onPointerUp(pe(p, mods), ctx)
}
const drag = (from: Vec2, to: Vec2, mods?: Partial<EditorPointerEvent['mods']>) => {
  tool().onPointerDown(pe(from, mods), ctx)
  // step > slop first so the drag engages
  tool().onPointerMove(pe(vec(from.x + 0.1, from.y + 0.1), mods), ctx)
  tool().onPointerMove(pe(to, mods), ctx)
  tool().onPointerUp(pe(to, mods), ctx)
}

beforeEach(() => {
  flushPendingNudge() // defuse any timer a prior test left armed
  if (isTxActive()) abortTx()
  registry.switchTo(ctx, 'select')
  useDocStore.setState({ doc: emptyDocument(newProjectId(), 'test', '2026-07-11T00:00:00.000Z') })
  clearHistory()
  resetDerivedForTests()
  useUiStore.getState().clearSelection()
  useUiStore.getState().setHovered(null)
  useUiStore.getState().setOptionsOpen(false)
  useUiStore.getState().setViewMode('2d')
  if (useConfirmStore.getState().pending) useConfirmStore.getState().resolve('')
  useViewportStore.setState({ k: 100, tx: 0, ty: 0, width: 800, height: 600 })
  useInteractionStore.getState().clear()
  useInteractionStore.getState().set({ pointerWorld: null }) // clear() spares it
  clearClipboardForTests()
})

const addSofa = (x = 2, y = 2): FurnitureId =>
  useDocStore.getState().addFurniture({
    catalogItemId: 'sofa-3',
    x,
    y,
    size: { w: 2.2, d: 0.95, h: 0.85 },
  })

describe('draw-wall tool', () => {
  beforeEach(() => registry.switchTo(ctx, 'draw-wall'))

  it('4-click close-loop: 4 walls + 1 room, one undo entry per segment', () => {
    click(vec(0, 0))
    click(vec(4, 0))
    click(vec(4, 3))
    click(vec(0, 3))
    click(vec(0.02, 0.02)) // near the chain start → closes the loop
    expect(walls()).toBe(4)
    expect(rooms()).toBe(1)
    expect(past()).toBe(4) // per segment
  })

  it('Backspace steps back one segment and continues the chain', () => {
    click(vec(0, 0))
    click(vec(4, 0))
    click(vec(4, 3))
    expect(walls()).toBe(2)
    expect(tool().onKeyDown?.('Backspace', ctx)).toBe(true)
    expect(walls()).toBe(1)
    // chain continues from the restored anchor
    click(vec(6, 0))
    expect(walls()).toBe(2)
  })

  it('Esc drops the rubber band only; committed segments stay', () => {
    click(vec(0, 0))
    click(vec(4, 0))
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    expect(walls()).toBe(1)
    // second Esc bubbles (ladder switches tools at the keymap level)
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(false)
  })

  it('Enter ends the chain without an extra segment', () => {
    click(vec(0, 0))
    click(vec(3, 0))
    expect(tool().onKeyDown?.('Enter', ctx)).toBe(true)
    click(vec(0, 5)) // starts a NEW chain (anchor only, no wall yet)
    expect(walls()).toBe(1)
  })
})

describe('select tool drags', () => {
  it('furniture drag = exactly one undo entry; position quantized to 1cm', () => {
    const id = addSofa()
    const base = past()
    useUiStore.getState().setSelection([id])
    drag(vec(2, 2), vec(3.503, 2.704))
    expect(past()).toBe(base + 1)
    const f = getActiveLevelDoc().furniture[id]!
    expect(f.x * 100).toBeCloseTo(Math.round(f.x * 100), 6)
    expect(f.x).toBeGreaterThan(3.3)
  })

  it('Esc mid-drag aborts: doc ref-equal to pre-drag snapshot, no entry', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    const pristine = useDocStore.getState().doc
    const base = past()
    tool().onPointerDown(pe(vec(2, 2)), ctx)
    tool().onPointerMove(pe(vec(3, 3)), ctx)
    expect(isTxActive()).toBe(true)
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    expect(useDocStore.getState().doc).toBe(pristine)
    expect(past()).toBe(base)
    expect(isTxActive()).toBe(false)
  })

  it('multi-select rigid drag moves all selected items by the same delta', () => {
    const a = addSofa(2, 2)
    const b = addSofa(6, 2)
    useUiStore.getState().setSelection([a, b])
    drag(vec(2, 2), vec(2.5, 3))
    const fa = getActiveLevelDoc().furniture[a]!
    const fb = getActiveLevelDoc().furniture[b]!
    expect(fa.x).toBeCloseTo(2.5, 6)
    expect(fa.y).toBeCloseTo(3, 6)
    expect(fb.x).toBeCloseTo(6.5, 6)
    expect(fb.y).toBeCloseTo(3, 6)
  })

  it('node drag onto another node merges them (drop target survives)', () => {
    useDocStore.getState().addWallSegment(vec(0, 0), vec(4, 0))
    useDocStore.getState().addWallSegment(vec(4, 0), vec(4, 3))
    useDocStore.getState().addWallSegment(vec(0, 3), vec(0, 5))
    const doc = getActiveLevelDoc()
    const dangling = Object.values(doc.nodes).find((n) => n.x === 0 && n.y === 3)!
    const target = Object.values(doc.nodes).find((n) => n.x === 0 && n.y === 0)!
    // select the dangling node's wall so the node becomes hittable
    const wall = Object.values(doc.walls).find((w) => w.a === dangling.id || w.b === dangling.id)!
    useUiStore.getState().setSelection([wall.id])
    const base = past()
    drag(vec(0, 3), vec(0.02, 0.03)) // drop near the target node → node snap → merge
    expect(getActiveLevelDoc().nodes[dangling.id]).toBeUndefined()
    expect(getActiveLevelDoc().nodes[target.id]).toBeDefined()
    expect(past()).toBe(base + 1)
  })

  it('wall drag translates perpendicular and keeps openings (one entry)', () => {
    const r = useDocStore.getState().addWallSegment(vec(0, 0), vec(6, 0))
    const opId = useDocStore.getState().addOpening({ kind: 'door', wallId: r.wallId!, t: 0.5 })!
    useUiStore.getState().setSelection([r.wallId!])
    const base = past()
    // grab clear of the door span [2.55, 3.45] so the WALL is the top hit
    drag(vec(1.2, 0), vec(1.2, 1.5))
    const doc = getActiveLevelDoc()
    const w = doc.walls[r.wallId!]!
    expect(doc.nodes[w.a]!.y).toBeCloseTo(1.5, 6)
    expect(doc.nodes[w.b]!.y).toBeCloseTo(1.5, 6)
    expect(doc.openings[opId]).toBeDefined()
    expect(past()).toBe(base + 1)
  })

  it('opening drag slides along its wall, clamped to the core', () => {
    const r = useDocStore.getState().addWallSegment(vec(0, 0), vec(6, 0))
    const opId = useDocStore.getState().addOpening({ kind: 'door', wallId: r.wallId!, t: 0.5 })!
    useUiStore.getState().setSelection([opId])
    drag(vec(3, 0), vec(5.9, 0)) // try to slide past the end
    const op = getActiveLevelDoc().openings[opId]!
    const u = op.t * 6
    expect(u + 0.45).toBeLessThanOrEqual(6 - 0.01 + 1e-9)
    expect(u).toBeGreaterThan(4) // did move right
  })

  it('click on empty space clears the selection', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    click(vec(9, 9))
    expect(useUiStore.getState().selection).toHaveLength(0)
  })
})

describe('live measurement pills', () => {
  const pills = () => useInteractionStore.getState().pills
  const pillTexts = () => pills().map((p) => p.text)
  const square = () =>
    useDocStore.getState().addWallChain([vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
  const addBox = (x: number, y: number) =>
    useDocStore.getState().addFurniture({
      catalogItemId: 'test-box',
      x,
      y,
      size: { w: 1, d: 0.6, h: 1 },
    })

  it('opening drag publishes width + gap pills tracking the live realized interval', () => {
    const r = useDocStore.getState().addWallSegment(vec(0, 0), vec(6, 0))
    const opId = useDocStore.getState().addOpening({ kind: 'door', wallId: r.wallId!, t: 0.5 })!
    useUiStore.getState().setSelection([opId])
    tool().onPointerDown(pe(vec(3, 0)), ctx)
    tool().onPointerMove(pe(vec(3.1, 0)), ctx) // past slop: drag arms
    tool().onPointerMove(pe(vec(3.6, 0)), ctx) // t → 0.6 ⇒ realized [3.15, 4.05]
    expect(pillTexts()).toEqual(['0.90 m', '3.15 m', '1.95 m'])
    tool().onPointerMove(pe(vec(4.2, 0)), ctx) // keeps tracking ⇒ [3.75, 4.65]
    expect(pillTexts()).toEqual(['0.90 m', '3.75 m', '1.35 m'])
    tool().onPointerUp(pe(vec(4.2, 0)), ctx)
    expect(pills()).toEqual([])
  })

  it('furniture drag publishes edge distances + passive wall lengths', () => {
    square()
    const id = addBox(2, 1.5)
    useUiStore.getState().setSelection([id])
    tool().onPointerDown(pe(vec(2, 1.5), { ctrl: true }), ctx)
    tool().onPointerMove(pe(vec(2.1, 1.5), { ctrl: true }), ctx) // arm
    tool().onPointerMove(pe(vec(2, 1.5), { ctrl: true }), ctx) // measure at the center
    const measure = pills().filter((p) => !p.tone)
    const passive = pills().filter((p) => p.tone === 'passive')
    expect(measure).toHaveLength(4)
    expect(measure.every((p) => p.from && p.to)).toBe(true)
    expect(passive.map((p) => p.text).sort()).toEqual(['3.00 m', '3.00 m', '4.00 m', '4.00 m'])
    tool().onPointerUp(pe(vec(2, 1.5), { ctrl: true }), ctx)
    expect(pills()).toEqual([])
  })

  it('group drag measures the grabbed item only', () => {
    square()
    const a = addBox(2, 1.5)
    const b = addBox(2.6, 1.5)
    useUiStore.getState().setSelection([a, b])
    tool().onPointerDown(pe(vec(2, 1.5), { ctrl: true }), ctx) // grabs a
    tool().onPointerMove(pe(vec(2.1, 1.5), { ctrl: true }), ctx)
    tool().onPointerMove(pe(vec(2, 1.4), { ctrl: true }), ctx)
    const dists = pills()
      .filter((p) => !p.tone)
      .map((p) => Math.hypot(p.to!.x - p.from!.x, p.to!.y - p.from!.y))
      .sort((x, y) => x - y)
    // a's clearances at (2, 1.4) — b's would be [0.825, …, 2.025]
    expect(dists).toHaveLength(4)
    expect(dists[0]).toBeCloseTo(1.025, 9)
    expect(dists[1]).toBeCloseTo(1.225, 9)
    expect(dists[2]).toBeCloseTo(1.425, 9)
    expect(dists[3]).toBeCloseTo(1.425, 9)
    // both items still moved rigidly
    tool().onPointerUp(pe(vec(2, 1.4), { ctrl: true }), ctx)
    expect(getActiveLevelDoc().furniture[b]!.y).toBeCloseTo(1.4, 6)
  })

  it('wall drag publishes incident wall lengths; Esc abort clears pills', () => {
    square()
    tool().onPointerDown(pe(vec(2, 0)), ctx)
    tool().onPointerMove(pe(vec(2, 0.1)), ctx) // arm
    tool().onPointerMove(pe(vec(2, 0.5)), ctx) // side walls live-shrink to 2.5
    expect(pillTexts().sort()).toEqual(['2.50 m', '2.50 m', '4.00 m'])
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    expect(pills()).toEqual([])
  })

  it('node drag publishes incident wall lengths', () => {
    const ids = square()
    useUiStore.getState().setSelection([ids[0]!]) // makes the corner node hittable
    tool().onPointerDown(pe(vec(0, 0)), ctx)
    tool().onPointerMove(pe(vec(0.1, 0.1)), ctx) // arm
    tool().onPointerMove(pe(vec(0, 1)), ctx)
    expect(pillTexts().sort()).toEqual(['2.00 m', '4.12 m'])
    tool().onPointerUp(pe(vec(0, 1)), ctx)
    expect(pills()).toEqual([])
  })
})

describe('measure tool', () => {
  const pills = () => useInteractionStore.getState().pills

  beforeEach(() => registry.switchTo(ctx, 'measure'))

  it('two clicks freeze a read-only pill; doc identity, history, tx untouched', () => {
    useDocStore.getState().addWallSegment(vec(0, 0), vec(6, 0))
    const pristine = useDocStore.getState().doc
    const base = past()
    tool().onPointerMove(pe(vec(1, 2)), ctx)
    expect(pills()).toEqual([]) // no first point yet — snap only
    click(vec(1, 2))
    expect(isTxActive()).toBe(false)
    tool().onPointerMove(pe(vec(3, 2)), ctx)
    expect(pills()).toHaveLength(1)
    expect(pills()[0]!.text).toBe('2.00 m')
    click(vec(3, 2))
    expect(pills()).toHaveLength(1)
    expect(pills()[0]!.tone).toBe('measure')
    expect(pills()[0]!.from!.x).toBeCloseTo(1, 9)
    expect(pills()[0]!.from!.y).toBeCloseTo(2, 9)
    expect(pills()[0]!.to!.x).toBeCloseTo(3, 9)
    expect(pills()[0]!.to!.y).toBeCloseTo(2, 9)
    // frozen pill survives hover moves after the 2nd click
    tool().onPointerMove(pe(vec(5, 5)), ctx)
    expect(pills()[0]!.text).toBe('2.00 m')
    expect(useDocStore.getState().doc).toBe(pristine)
    expect(past()).toBe(base)
    expect(isTxActive()).toBe(false)
  })

  it('node-to-node across a wall snaps to the exact wall length', () => {
    useDocStore.getState().addWallSegment(vec(0, 0), vec(4, 0))
    click(vec(0.03, 0.04)) // within the 10px node capture radius
    tool().onPointerMove(pe(vec(3.95, 0.05)), ctx)
    click(vec(3.95, 0.05))
    expect(pills()).toHaveLength(1)
    expect(pills()[0]!.text).toBe('4.00 m')
  })

  it('a 3rd click starts a fresh measurement', () => {
    click(vec(0, 0))
    click(vec(2, 0))
    expect(pills()[0]!.text).toBe('2.00 m')
    click(vec(10, 10)) // new first point — old pill gone
    expect(pills()).toEqual([])
    tool().onPointerMove(pe(vec(10, 13)), ctx)
    expect(pills()[0]!.text).toBe('3.00 m')
  })

  it('Esc: pending point → true; frozen pill → true; idle → false (bubbles)', () => {
    click(vec(1, 1))
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    expect(pills()).toEqual([])
    click(vec(1, 1))
    click(vec(2, 1))
    expect(pills()).toHaveLength(1)
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    expect(pills()).toEqual([])
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(false)
  })
})

describe('switchTool (shared keymap/toolbar switch path)', () => {
  it('clears a frozen measure pill on switch (onDeactivate runs)', () => {
    switchTool('measure')
    click(vec(1, 1))
    click(vec(3, 1))
    expect(useInteractionStore.getState().pills).toHaveLength(1)
    switchTool('select')
    expect(useUiStore.getState().activeTool).toBe('select')
    expect(useInteractionStore.getState().pills).toEqual([])
  })

  it('toolbar-style switch aborts a pending wall chain (regression: setActiveTool bypassed onDeactivate)', () => {
    switchTool('draw-wall')
    click(vec(0, 0)) // pending anchor publishes a preview
    expect(useInteractionStore.getState().preview).not.toBeNull()
    switchTool('select')
    expect(useInteractionStore.getState().preview).toBeNull()
    // and the dropped anchor is really gone: reactivating draws nothing yet
    switchTool('draw-wall')
    click(vec(2, 0))
    expect(walls()).toBe(0) // first click of a NEW chain, not a segment
  })
})

describe('keymap', () => {
  it('focus guard: typing "w" in an input does NOT switch tools', () => {
    handleKey(key('w', { editableTarget: true }), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('select')
    handleKey(key('w'), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('draw-wall')
  })

  it('Esc ladder: tool state → select tool → deselect', () => {
    registry.switchTo(ctx, 'draw-wall')
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    // draw-wall with a live anchor: first Esc eats it
    tool().onPointerDown(pe(vec(0, 0)), ctx)
    handleKey(key('Escape'), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('draw-wall')
    // second Esc: back to select
    handleKey(key('Escape'), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('select')
    // third: deselect
    handleKey(key('Escape'), ctx, registry)
    expect(useUiStore.getState().selection).toHaveLength(0)
  })

  it('Del cascades the selection; rooms are never deleted directly', () => {
    useDocStore
      .getState()
      .addWallChain([vec(0, 0), vec(4, 0), vec(4, 4), vec(0, 4), vec(0, 0)])
    const roomId = Object.keys(getActiveLevelDoc().rooms)[0]!
    const wallId = Object.keys(getActiveLevelDoc().walls)[0]!
    useUiStore.getState().setSelection([roomId])
    handleKey(key('Delete'), ctx, registry)
    expect(rooms()).toBe(1) // room selection is a no-op
    useUiStore.getState().setSelection([wallId])
    handleKey(key('Delete'), ctx, registry)
    expect(walls()).toBe(3)
  })

  it('R rotates every selected item 90° in ONE undo entry', () => {
    const a = addSofa(2, 2)
    const b = addSofa(6, 2)
    useUiStore.getState().setSelection([a, b])
    const base = past()
    handleKey(key('r'), ctx, registry)
    expect(getActiveLevelDoc().furniture[a]!.rotation).toBeCloseTo(Math.PI / 2, 9)
    expect(getActiveLevelDoc().furniture[b]!.rotation).toBeCloseTo(Math.PI / 2, 9)
    expect(past()).toBe(base + 1)
  })

  it('Ctrl+D duplicates at +0.25 and selects the copies', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    handleKey(key('d', { ctrlKey: true }), ctx, registry)
    const sel = useUiStore.getState().selection
    expect(sel).toHaveLength(1)
    expect(sel[0]).not.toBe(id)
    const copy = getActiveLevelDoc().furniture[sel[0]! as FurnitureId]!
    expect(copy.x).toBeCloseTo(2.25, 9)
  })

  it('arrow nudges coalesce into a single undo entry', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    const base = past()
    handleKey(key('ArrowRight'), ctx, registry)
    handleKey(key('ArrowRight'), ctx, registry)
    handleKey(key('ArrowDown', { shiftKey: true }), ctx, registry)
    flushPendingNudge()
    expect(past()).toBe(base + 1)
    const f = getActiveLevelDoc().furniture[id]!
    expect(f.x).toBeCloseTo(2.02, 9)
    expect(f.y).toBeCloseTo(1.9, 9) // Down = −y: the view renders y-UP (B3)
  })

  it('nudge directions match the y-up render: Up = +y, Down = −y (B3)', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    handleKey(key('ArrowUp'), ctx, registry)
    flushPendingNudge()
    expect(getActiveLevelDoc().furniture[id]!.y).toBeCloseTo(2.01, 9)
    handleKey(key('ArrowDown'), ctx, registry)
    handleKey(key('ArrowDown'), ctx, registry)
    flushPendingNudge()
    expect(getActiveLevelDoc().furniture[id]!.y).toBeCloseTo(1.99, 9)
  })

  it('undo/redo are swallowed while a transaction is live', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    tool().onPointerDown(pe(vec(2, 2)), ctx)
    tool().onPointerMove(pe(vec(3, 3)), ctx)
    const during = useDocStore.getState().doc
    handleKey(key('z', { ctrlKey: true }), ctx, registry)
    expect(useDocStore.getState().doc).toBe(during)
    tool().onKeyDown?.('Escape', ctx)
  })

  it('Space toggles pan state down/up', () => {
    handleKey(key(' '), ctx, registry)
    expect(useUiStore.getState().spaceHeld).toBe(true)
    handleKeyUp({ key: ' ' }, ctx)
    expect(useUiStore.getState().spaceHeld).toBe(false)
  })
})

describe('clipboard copy/paste', () => {
  const copy = () => handleKey(key('c', { ctrlKey: true }), ctx, registry)
  const paste = () => handleKey(key('v', { ctrlKey: true }), ctx, registry)
  const furnitureCount = () => Object.keys(getActiveLevelDoc().furniture).length

  it('Ctrl+C/Ctrl+V pastes at pointerWorld as ONE undo entry and selects the copy', () => {
    const id = addSofa(2, 2)
    useUiStore.getState().setSelection([id])
    useInteractionStore.getState().set({ pointerWorld: vec(6, 7) })
    copy()
    const base = past()
    paste()
    expect(past()).toBe(base + 1)
    const sel = useUiStore.getState().selection
    expect(sel).toHaveLength(1)
    expect(sel[0]).not.toBe(id)
    const f = getActiveLevelDoc().furniture[sel[0]! as FurnitureId]!
    expect(f.x).toBeCloseTo(6, 9)
    expect(f.y).toBeCloseTo(7, 9)
    expect(f.catalogItemId).toBe('sofa-3')
  })

  it('multi-item paste preserves relative offsets around the centroid', () => {
    const a = addSofa(2, 2)
    const b = addSofa(4, 3)
    useUiStore.getState().setSelection([a, b])
    copy()
    useInteractionStore.getState().set({ pointerWorld: vec(10, 10) })
    const base = past()
    paste()
    expect(past()).toBe(base + 1)
    const sel = useUiStore.getState().selection
    expect(sel).toHaveLength(2)
    const [fa, fb] = sel.map((s) => getActiveLevelDoc().furniture[s as FurnitureId]!)
    expect(fa!.x).toBeCloseTo(9, 9) // centroid (3, 2.5) → target (10, 10)
    expect(fa!.y).toBeCloseTo(9.5, 9)
    expect(fb!.x).toBeCloseTo(11, 9)
    expect(fb!.y).toBeCloseTo(10.5, 9)
  })

  it('paste with the pointer off-canvas lands at the copy anchor + 0.25', () => {
    const id = addSofa(2, 2)
    useUiStore.getState().setSelection([id])
    copy()
    paste() // beforeEach left pointerWorld null
    const f =
      getActiveLevelDoc().furniture[useUiStore.getState().selection[0]! as FurnitureId]!
    expect(f.x).toBeCloseTo(2.25, 9)
    expect(f.y).toBeCloseTo(2.25, 9)
  })

  it('clipboard survives replaceDocument — paste lands in the fresh doc', () => {
    const id = addSofa(2, 2)
    useUiStore.getState().setSelection([id])
    copy()
    useDocStore
      .getState()
      .replaceDocument(emptyDocument(newProjectId(), 'fresh', '2026-07-12T00:00:00.000Z'))
    expect(furnitureCount()).toBe(0)
    paste()
    expect(furnitureCount()).toBe(1)
  })

  it('Ctrl+V is a no-op mid-transaction', () => {
    const id = addSofa(2, 2)
    useUiStore.getState().setSelection([id])
    copy()
    tool().onPointerDown(pe(vec(2, 2)), ctx)
    tool().onPointerMove(pe(vec(3, 3)), ctx) // live drag → tx active
    expect(isTxActive()).toBe(true)
    paste()
    expect(furnitureCount()).toBe(1)
    tool().onKeyDown?.('Escape', ctx)
  })

  // 0.3.0 deliberate rewrite: walls are copyable now (M9 graph clipboard)
  it('copying a wall-only selection fills the clipboard; paste recreates the wall', () => {
    const r = useDocStore.getState().addWallSegment(vec(0, 0), vec(4, 0))
    useUiStore.getState().setSelection([r.wallId!])
    copy()
    expect(hasClipboard()).toBe(true)
    const before = walls()
    useInteractionStore.getState().set({ pointerWorld: vec(10, 10) })
    paste()
    expect(walls()).toBe(before + 1)
    expect(furnitureCount()).toBe(0)
  })

  it('mirrored rides along through copy/paste', () => {
    const id = addSofa(2, 2)
    useDocStore.getState().transformFurniture(id, { mirrored: true })
    useUiStore.getState().setSelection([id])
    copy()
    paste()
    const f =
      getActiveLevelDoc().furniture[useUiStore.getState().selection[0]! as FurnitureId]!
    expect(f.mirrored).toBe(true)
  })

  it('addFurnitureBatch commits N items as ONE undo entry', () => {
    const base = past()
    const ids = useDocStore.getState().addFurnitureBatch([
      { catalogItemId: 'test-box', x: 1, y: 1, size: { w: 1, d: 1, h: 1 } },
      { catalogItemId: 'test-box', x: 3, y: 1, size: { w: 1, d: 1, h: 1 } },
    ])
    expect(ids).toHaveLength(2)
    expect(past()).toBe(base + 1)
  })
})

describe('flip (F)', () => {
  it('F toggles mirrored on every selected item in ONE undo entry; false deletes the field', () => {
    const a = addSofa(2, 2)
    const b = addSofa(6, 2)
    useUiStore.getState().setSelection([a, b])
    const base = past()
    handleKey(key('f'), ctx, registry)
    expect(past()).toBe(base + 1)
    expect(getActiveLevelDoc().furniture[a]!.mirrored).toBe(true)
    expect(getActiveLevelDoc().furniture[b]!.mirrored).toBe(true)
    handleKey(key('f'), ctx, registry)
    expect(past()).toBe(base + 2)
    expect('mirrored' in getActiveLevelDoc().furniture[a]!).toBe(false)
    expect('mirrored' in getActiveLevelDoc().furniture[b]!).toBe(false)
  })

  it('F without selected furniture falls through (no entry)', () => {
    const r = useDocStore.getState().addWallSegment(vec(0, 0), vec(4, 0))
    useUiStore.getState().setSelection([r.wallId!])
    const base = past()
    handleKey(key('f'), ctx, registry)
    expect(past()).toBe(base)
    expect(isTxActive()).toBe(false)
  })
})

describe('2D viewport navigation', () => {
  // 0.3.0 deliberate rewrite: empty-space left-drag is MARQUEE SELECT now —
  // panning lives on Space/middle/right-drag (Editor2D layer) + wheel/arrows
  it('empty-space left-drag draws a marquee: intersecting entities select, viewport and history untouched', () => {
    const id = addSofa(2, 2) // sofa 2.2×0.95 at (2,2)
    const far = addSofa(9, 9)
    useDocStore.getState().addWallSegment(vec(0, 4), vec(4, 4))
    const base = past()
    tool().onPointerDown(pe(vec(0.5, 0.5)), ctx)
    tool().onPointerMove(pe(vec(1.5, 1.6)), ctx) // past slop → marquee engages
    expect(isTxActive()).toBe(false)
    expect(useInteractionStore.getState().preview?.kind).toBe('marquee')
    tool().onPointerMove(pe(vec(4.5, 4.5)), ctx) // box covers sofa + wall
    const sel = useUiStore.getState().selection
    expect(sel).toContain(id)
    expect(sel.some((s) => getActiveLevelDoc().walls[s as never])).toBe(true)
    expect(sel).not.toContain(far)
    tool().onPointerUp(pe(vec(4.5, 4.5)), ctx)
    expect(useUiStore.getState().selection).toEqual(sel) // committed as-is
    expect(useInteractionStore.getState().preview).toBeNull()
    expect(useViewportStore.getState().tx).toBe(0) // no pan
    expect(past()).toBe(base) // selection is not undoable
    expect(isTxActive()).toBe(false)
  })

  it('Shift+marquee ADDS to the selection; Esc mid-marquee restores the prior one', () => {
    const a = addSofa(2, 2)
    const b = addSofa(9, 9)
    useUiStore.getState().setSelection([b])
    tool().onPointerDown(pe(vec(0.5, 0.5), { shift: true }), ctx)
    tool().onPointerMove(pe(vec(4, 4), { shift: true }), ctx)
    expect(new Set(useUiStore.getState().selection)).toEqual(new Set([a, b]))
    // cancel: prior selection restored, preview gone
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    expect(useUiStore.getState().selection).toEqual([b])
    expect(useInteractionStore.getState().preview).toBeNull()
  })

  it('marquee touching an entity edge selects it (intersection, not containment)', () => {
    useDocStore.getState().addWallSegment(vec(0, 2), vec(10, 2))
    tool().onPointerDown(pe(vec(1, 1)), ctx)
    tool().onPointerMove(pe(vec(3, 3)), ctx) // box crosses the wall, doesn't contain it
    const sel = useUiStore.getState().selection
    expect(sel).toHaveLength(1)
    expect(getActiveLevelDoc().walls[sel[0]! as never]).toBeDefined()
    tool().onPointerUp(pe(vec(3, 3)), ctx)
  })

  it('a marquee can START on a room floor (boxing furniture inside a room)', () => {
    useDocStore
      .getState()
      .addWallChain([vec(0, 0), vec(6, 0), vec(6, 5), vec(0, 5), vec(0, 0)])
    const sofa = addSofa(3, 2.5) // inside the room
    tool().onPointerDown(pe(vec(1.5, 1.5)), ctx) // room floor: click-selects the room…
    tool().onPointerMove(pe(vec(4.5, 3.5)), ctx) // …but a DRAG is the marquee
    const sel = useUiStore.getState().selection
    expect(sel).toContain(sofa)
    // non-additive marquee: the room from the initial press is dropped
    expect(sel.some((id) => getActiveLevelDoc().rooms[id as never])).toBe(false)
    // walls untouched by the box stay unselected
    expect(sel.some((id) => getActiveLevelDoc().walls[id as never])).toBe(false)
    tool().onPointerUp(pe(vec(4.5, 3.5)), ctx)
    expect(useUiStore.getState().selection).toContain(sofa)
  })

  it('sub-slop press-release on empty space still clears the selection', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    tool().onPointerDown(pe(vec(8, 8)), ctx)
    tool().onPointerMove(pe(vec(8.02, 8.02)), ctx) // ~2.8px < 4px slop
    tool().onPointerUp(pe(vec(8.02, 8.02)), ctx)
    expect(useUiStore.getState().selection).toHaveLength(0)
    expect(useViewportStore.getState().tx).toBe(0)
  })

  it('Escape mid-marquee is consumed; later moves are inert hovers', () => {
    tool().onPointerDown(pe(vec(8, 8)), ctx)
    tool().onPointerMove(pe(vec(8.5, 8.5)), ctx)
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    tool().onPointerMove(pe(vec(10, 10)), ctx)
    expect(useInteractionStore.getState().preview).toBeNull()
    expect(useUiStore.getState().selection).toHaveLength(0)
    expect(past()).toBe(0)
    expect(isTxActive()).toBe(false)
  })

  it('arrows pan when nothing is selected (Shift = 3×) — no tx, no undo entries', () => {
    handleKey(key('ArrowLeft'), ctx, registry)
    expect(useViewportStore.getState().tx).toBe(80)
    handleKey(key('ArrowRight', { shiftKey: true }), ctx, registry)
    expect(useViewportStore.getState().tx).toBe(-160)
    handleKey(key('ArrowUp'), ctx, registry)
    expect(useViewportStore.getState().ty).toBe(80)
    handleKey(key('ArrowDown'), ctx, registry)
    expect(useViewportStore.getState().ty).toBe(0)
    expect(past()).toBe(0)
    expect(isTxActive()).toBe(false)
  })

  it('arrows pan with a wall selected (furniture filter empty); the wall stays put', () => {
    const r = useDocStore.getState().addWallSegment(vec(0, 0), vec(4, 0))
    useUiStore.getState().setSelection([r.wallId!])
    const base = past()
    handleKey(key('ArrowUp'), ctx, registry)
    expect(useViewportStore.getState().ty).toBe(80)
    expect(past()).toBe(base)
    const w = getActiveLevelDoc().walls[r.wallId!]!
    expect(getActiveLevelDoc().nodes[w.a]!.y).toBe(0)
  })

  it('arrows still nudge (never pan) with furniture selected', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    handleKey(key('ArrowRight'), ctx, registry)
    flushPendingNudge()
    expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2.01, 9)
    expect(useViewportStore.getState().tx).toBe(0)
  })

  it('arrow pan is 2D-only', () => {
    useUiStore.getState().setViewMode('3d')
    handleKey(key('ArrowLeft'), ctx, registry)
    expect(useViewportStore.getState().tx).toBe(0)
  })

  it("'+'/'=' zoom in and '-'/'_' zoom out, all about the viewport center", () => {
    const before = screenToWorld(vec(400, 300), useViewportStore.getState())
    handleKey(key('+'), ctx, registry)
    expect(useViewportStore.getState().k).toBeCloseTo(125, 9) // ×1.25
    const mid = screenToWorld(vec(400, 300), useViewportStore.getState())
    expect(mid.x).toBeCloseTo(before.x, 9)
    expect(mid.y).toBeCloseTo(before.y, 9)
    handleKey(key('='), ctx, registry)
    expect(useViewportStore.getState().k).toBeCloseTo(156.25, 9)
    handleKey(key('-'), ctx, registry)
    handleKey(key('_', { shiftKey: true }), ctx, registry)
    expect(useViewportStore.getState().k).toBeCloseTo(100, 9)
    const after = screenToWorld(vec(400, 300), useViewportStore.getState())
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('zoom keys are dropped in 3D view, while typing, and with Ctrl held', () => {
    useUiStore.getState().setViewMode('3d')
    handleKey(key('+'), ctx, registry)
    expect(useViewportStore.getState().k).toBe(100)
    useUiStore.getState().setViewMode('2d')
    handleKey(key('+', { editableTarget: true }), ctx, registry)
    expect(useViewportStore.getState().k).toBe(100)
    handleKey(key('-', { ctrlKey: true }), ctx, registry)
    expect(useViewportStore.getState().k).toBe(100)
    handleKey(key('+'), ctx, registry)
    expect(useViewportStore.getState().k).toBeCloseTo(125, 9)
  })
})

describe('keymap 3D gate (M6): file ops stay live, editing keys are 2D-only', () => {
  beforeEach(() => useUiStore.getState().setViewMode('3d'))

  it('3d: arrows neither nudge furniture nor pan the viewport', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    handleKey(key('ArrowRight'), ctx, registry)
    flushPendingNudge()
    expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2, 9)
    useUiStore.getState().clearSelection()
    handleKey(key('ArrowLeft'), ctx, registry)
    expect(useViewportStore.getState().tx).toBe(0)
    expect(past()).toBe(1) // only the addSofa entry
  })

  it('3d: v/w/d/n/m do not switch tools', () => {
    for (const k of ['w', 'd', 'n', 'm']) {
      handleKey(key(k), ctx, registry)
      expect(useUiStore.getState().activeTool).toBe('select')
    }
    registry.switchTo(ctx, 'draw-wall')
    handleKey(key('v'), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('draw-wall')
  })

  it('3d: Delete keeps the entities and the selection', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    handleKey(key('Delete'), ctx, registry)
    expect(getActiveLevelDoc().furniture[id]).toBeDefined()
    expect(useUiStore.getState().selection).toEqual([id])
  })

  it('3d: Ctrl+Z does not undo', () => {
    const id = addSofa()
    const base = past()
    handleKey(key('z', { ctrlKey: true }), ctx, registry)
    expect(past()).toBe(base)
    expect(getActiveLevelDoc().furniture[id]).toBeDefined()
  })

  it('3d: Ctrl+S still reaches the file ops (save hits the adapter)', async () => {
    let saveAsCalls = 0
    const fake: StorageAdapter = {
      kind: 'browser',
      openDialog: async () => null,
      openImageDialog: async () => null,
      saveAsDialog: async () => {
        saveAsCalls++
        return null // "cancelled" — saveProject bails without state changes
      },
      saveBinaryDialog: async () => null,
      setTitle: () => {},
      installCloseGuard: () => {},
      message: async () => {},
    }
    const prev = usePersistStore.getState().adapter
    usePersistStore.setState({ adapter: fake })
    try {
      let prevented = false
      handleKey(
        key('s', { ctrlKey: true, preventDefault: () => (prevented = true) }),
        ctx,
        registry,
      )
      expect(prevented).toBe(true) // the Ctrl+S branch claimed the key
      await vi.waitFor(() => expect(saveAsCalls).toBe(1))
    } finally {
      usePersistStore.setState({ adapter: prev })
    }
  })

  it('2d behaviors unchanged: tools, undo, and arrow pan still work', () => {
    useUiStore.getState().setViewMode('2d')
    handleKey(key('w'), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('draw-wall')
    registry.switchTo(ctx, 'select')
    const id = addSofa()
    const base = past()
    handleKey(key('z', { ctrlKey: true }), ctx, registry)
    expect(past()).toBe(base - 1)
    expect(getActiveLevelDoc().furniture[id]).toBeUndefined()
    handleKey(key('ArrowLeft'), ctx, registry)
    expect(useViewportStore.getState().tx).toBe(80)
  })
})

describe('keymap modal guard', () => {
  it('drops every shortcut while a confirm prompt is pending', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    const base = past()
    void useConfirmStore.getState().prompt('Unsaved changes', 'Save?', [
      { label: 'Save', value: 'save', variant: 'primary' },
      { label: 'Cancel', value: 'cancel' },
    ])
    handleKey(key('w'), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('select')
    handleKey(key('Delete'), ctx, registry)
    expect(getActiveLevelDoc().furniture[id]).toBeDefined()
    handleKey(key('z', { ctrlKey: true }), ctx, registry)
    expect(past()).toBe(base)
    useConfirmStore.getState().resolve('cancel')
  })

  it('Escape resolves a pending confirm as its LAST button value', async () => {
    const p = useConfirmStore.getState().prompt('Unsaved changes', 'Save?', [
      { label: 'Save', value: 'save', variant: 'primary' },
      { label: 'Discard', value: 'discard', variant: 'danger' },
      { label: 'Cancel', value: 'cancel' },
    ])
    handleKey(key('Escape'), ctx, registry)
    await expect(p).resolves.toBe('cancel')
    expect(useConfirmStore.getState().pending).toBeNull()
    // keys flow again once the prompt is settled
    handleKey(key('w'), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('draw-wall')
  })

  it('drops every shortcut while the Options dialog is open (Escape stays inert)', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    useUiStore.getState().setOptionsOpen(true)
    handleKey(key('w'), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('select')
    handleKey(key('Delete'), ctx, registry)
    expect(getActiveLevelDoc().furniture[id]).toBeDefined()
    // the dialog owns Escape via its own listener — the keymap must not act
    handleKey(key('Escape'), ctx, registry)
    expect(useUiStore.getState().optionsOpen).toBe(true)
    expect(useUiStore.getState().selection).toEqual([id])
    useUiStore.getState().setOptionsOpen(false)
    handleKey(key('w'), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('draw-wall')
  })
})

describe('M1 (0.3.0): nudge preemption, chorded input, ghost keys', () => {
  it('a drag starting inside the nudge idle window: nudge survives as its own entry, the stale timer cannot steal the drag tx', () => {
    vi.useFakeTimers()
    try {
      const id = addSofa()
      useUiStore.getState().setSelection([id])
      const base = past()
      handleKey(key('ArrowRight'), ctx, registry) // x → 2.01, tx open, timer armed
      // drag begins before the 300ms idle commit
      tool().onPointerDown(pe(vec(2.01, 2)), ctx)
      tool().onPointerMove(pe(vec(2.11, 2.1)), ctx) // > slop ⇒ beginTx preempt-commits the nudge
      expect(past()).toBe(base + 1) // the nudge survived as one entry
      vi.advanceTimersByTime(300) // stale nudge timer fires MID-DRAG
      expect(isTxActive()).toBe(true) // …and must not commit the drag's tx
      tool().onPointerMove(pe(vec(3.01, 2.5)), ctx)
      tool().onPointerUp(pe(vec(3.01, 2.5)), ctx)
      expect(isTxActive()).toBe(false)
      expect(past()).toBe(base + 2) // nudge + drag = exactly two entries
      safeUndo()
      expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2.01, 9)
      safeUndo()
      expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2, 9)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a keymap tool switch inside the idle window flushes the nudge first (one entry, kept)', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    const base = past()
    handleKey(key('ArrowRight'), ctx, registry)
    handleKey(key('w'), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('draw-wall')
    expect(isTxActive()).toBe(false)
    expect(past()).toBe(base + 1)
    expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2.01, 9)
  })

  it('a direct switchTool call (toolbar) cannot revert a pending nudge; the idle timer still commits it', () => {
    vi.useFakeTimers()
    try {
      const id = addSofa()
      useUiStore.getState().setSelection([id])
      const base = past()
      handleKey(key('ArrowRight'), ctx, registry)
      switchTool('measure') // outgoing select onDeactivate owns no tx — must not abort
      expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2.01, 9)
      vi.advanceTimersByTime(300)
      expect(isTxActive()).toBe(false)
      expect(past()).toBe(base + 1)
      expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2.01, 9)
    } finally {
      vi.useRealTimers()
    }
  })

  it('Ctrl+Z inside the idle window undoes the nudge instead of being swallowed', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    handleKey(key('ArrowRight'), ctx, registry)
    handleKey(key('z', { ctrlKey: true }), ctx, registry)
    expect(isTxActive()).toBe(false)
    expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2, 9)
  })

  it('R rotates the placement ghost, not the just-placed item (S3)', () => {
    useUiStore.getState().setToolParams({ catalogItemId: 'sofa-3' })
    switchTool('place-furniture')
    tool().onPointerDown(pe(vec(2, 2)), ctx) // place #1 → selects it
    const first = useUiStore.getState().selection[0]! as FurnitureId
    expect(getActiveLevelDoc().furniture[first]).toBeDefined()
    handleKey(key('r'), ctx, registry) // must reach the GHOST, not the selection
    expect(getActiveLevelDoc().furniture[first]!.rotation).toBe(0)
    tool().onPointerDown(pe(vec(6, 6)), ctx) // place #2 carries the ghost angle
    const second = useUiStore.getState().selection[0]! as FurnitureId
    expect(second).not.toBe(first)
    expect(getActiveLevelDoc().furniture[second]!.rotation).toBeCloseTo(Math.PI / 2, 9)
  })

  it('F mirrors the placement ghost; R/F still act on the selection in the select tool', () => {
    useUiStore.getState().setToolParams({ catalogItemId: 'sofa-3' })
    switchTool('place-furniture')
    handleKey(key('f'), ctx, registry)
    tool().onPointerDown(pe(vec(2, 2)), ctx)
    const placed = useUiStore.getState().selection[0]! as FurnitureId
    expect(getActiveLevelDoc().furniture[placed]!.mirrored).toBe(true)
    switchTool('select')
    handleKey(key('r'), ctx, registry) // global handler again: rotates the selection
    expect(getActiveLevelDoc().furniture[placed]!.rotation).toBeCloseTo(Math.PI / 2, 9)
  })

  it('releasing the primary button while another is held ends the drag (chorded release, R6)', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    const base = past()
    tool().onPointerDown(pe(vec(2, 2)), ctx)
    tool().onPointerMove({ ...pe(vec(2.1, 2.1)), buttons: 3 }, ctx) // engage (left+right held)
    tool().onPointerMove({ ...pe(vec(2.5, 2.5)), buttons: 3 }, ctx)
    expect(isTxActive()).toBe(true)
    tool().onPointerMove({ ...pe(vec(2.6, 2.6)), buttons: 2 }, ctx) // left lifted, right held
    expect(isTxActive()).toBe(false) // gesture committed — no phantom tracking
    expect(past()).toBe(base + 1)
    expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2.5, 9)
  })
})

describe('M1 (0.3.0): draw-wall rejected segments (R8)', () => {
  beforeEach(() => registry.switchTo(ctx, 'draw-wall'))

  it('a rejected duplicate segment does not advance the anchor', () => {
    click(vec(0, 0))
    click(vec(4, 0)) // wall A→B, anchor at B
    click(vec(0, 0)) // B→A duplicates A→B → rejected, anchor must stay at B
    expect(walls()).toBe(1)
    click(vec(4, 3)) // continues from B(4,0), not from A(0,0)
    expect(walls()).toBe(2)
    const doc = getActiveLevelDoc()
    const corner = Object.values(doc.nodes).find((n) => n.x === 4 && n.y === 3)!
    const wall = Object.values(doc.walls).find((w) => w.a === corner.id || w.b === corner.id)!
    const otherId = wall.a === corner.id ? wall.b : wall.a
    expect(doc.nodes[otherId]!.x).toBe(4)
    expect(doc.nodes[otherId]!.y).toBe(0)
  })

  it('a micro click near the anchor commits nothing and the chain continues from the anchor', () => {
    // zoomed in: the 4px double-click slop (0.004m at k=1000) is smaller than
    // minWallLength, so a micro click is a REJECTED segment, not a dbl-click
    // (Ctrl suspends snapping so the raw click point survives)
    useViewportStore.setState({ k: 1000 })
    click(vec(0, 0))
    click(vec(0.006, 0), { ctrl: true }) // < minWallLength → rejected
    expect(walls()).toBe(0)
    click(vec(3, 0), { ctrl: true })
    expect(walls()).toBe(1)
  })

  it('Backspace with an armed anchor and zero segments retracts the anchor', () => {
    click(vec(0, 0))
    expect(tool().onKeyDown?.('Backspace', ctx)).toBe(true)
    // fully reset: the next Backspace bubbles to the keymap deletion path
    expect(tool().onKeyDown?.('Backspace', ctx)).toBe(false)
    click(vec(1, 1))
    click(vec(4, 1))
    expect(walls()).toBe(1) // chain re-arms cleanly after the retraction
  })
})

describe('M1 (0.3.0): review-hardening pins', () => {
  it('chorded primary release while merely pressed runs click semantics', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    tool().onPointerDown(pe(vec(6, 6)), ctx) // press on empty space
    tool().onPointerMove({ ...pe(vec(6.01, 6)), buttons: 2 }, ctx) // left lifted under slop
    expect(useUiStore.getState().selection).toEqual([]) // click-on-nothing cleared
    expect(isTxActive()).toBe(false)
  })

  it('Escape cancels a pressed-but-not-dragging press (pointercancel path)', () => {
    const id = addSofa()
    tool().onPointerDown(pe(vec(2, 2)), ctx) // selects + presses
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    // press is dead: a later move must not start a drag
    tool().onPointerMove(pe(vec(4, 4)), ctx)
    tool().onPointerMove(pe(vec(5, 5)), ctx)
    expect(isTxActive()).toBe(false)
    expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2, 9)
  })

  it('arrow keys during a foreign drag are swallowed, never folded into its tx', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    tool().onPointerDown(pe(vec(2, 2)), ctx)
    tool().onPointerMove(pe(vec(2.5, 2.5)), ctx) // drag engaged, tx open
    const during = useDocStore.getState().doc
    handleKey(key('ArrowRight'), ctx, registry)
    expect(useDocStore.getState().doc).toBe(during) // no mutation joined the drag
    tool().onKeyDown?.('Escape', ctx) // abort the drag
    expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2, 9)
  })

  it('Shift+R counter-rotates the placement ghost', () => {
    useUiStore.getState().setToolParams({ catalogItemId: 'sofa-3' })
    switchTool('place-furniture')
    handleKey(key('R', { shiftKey: true }), ctx, registry)
    tool().onPointerDown(pe(vec(2, 2)), ctx)
    const placed = useUiStore.getState().selection[0]! as FurnitureId
    expect(getActiveLevelDoc().furniture[placed]!.rotation).toBeCloseTo(-Math.PI / 2, 9)
  })

  it('a bare AltGraph tap mid-run does not split the nudge (EU layouts)', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    const base = past()
    handleKey(key('ArrowRight'), ctx, registry)
    handleKey(key('AltGraph'), ctx, registry)
    handleKey(key('ArrowRight'), ctx, registry)
    flushPendingNudge()
    expect(past()).toBe(base + 1) // ONE coalesced entry
    expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2.02, 9)
  })

  it('re-arming with a DIFFERENT card resets the ghost rotation/mirror (same-tool path)', () => {
    useUiStore.getState().setToolParams({ catalogItemId: 'sofa-3' })
    switchTool('place-furniture')
    handleKey(key('r'), ctx, registry)
    handleKey(key('f'), ctx, registry)
    // switching cards keeps the tool active — onDeactivate never runs
    useUiStore.getState().setToolParams({ catalogItemId: 'bed-double' })
    tool().onPointerDown(pe(vec(3, 3)), ctx)
    const placed = useUiStore.getState().selection[0]! as FurnitureId
    const f = getActiveLevelDoc().furniture[placed]!
    expect(f.rotation).toBe(0)
    expect(f.mirrored).toBeUndefined()
  })

  it('ghost rotation/mirror reset when the tool properly deactivates', () => {
    useUiStore.getState().setToolParams({ catalogItemId: 'sofa-3' })
    switchTool('place-furniture')
    handleKey(key('f'), ctx, registry)
    handleKey(key('r'), ctx, registry)
    switchTool('select') // onDeactivate clears params + ghost state
    expect(useUiStore.getState().toolParams.catalogItemId).toBeNull()
    useUiStore.getState().setToolParams({ catalogItemId: 'sofa-3' })
    switchTool('place-furniture')
    tool().onPointerDown(pe(vec(2, 2)), ctx)
    const placed = useUiStore.getState().selection[0]! as FurnitureId
    const f = getActiveLevelDoc().furniture[placed]!
    expect(f.mirrored).toBeUndefined()
    expect(f.rotation).toBe(0)
  })

  it('Backspace that flushes a nudge is swallowed: the wall chain stays intact', () => {
    const id = addSofa(8, 8)
    registry.switchTo(ctx, 'draw-wall')
    click(vec(0, 0))
    click(vec(4, 0))
    useUiStore.getState().setSelection([id])
    handleKey(key('ArrowRight'), ctx, registry) // nudge tx pending
    handleKey(key('Backspace'), ctx, registry) // flushes + is swallowed
    expect(walls()).toBe(1) // the segment was NOT stepped back
    expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(8.01, 9) // nudge kept
    expect(isTxActive()).toBe(false)
  })

  it('Escape force-aborts a stuck ownerless transaction (safety net)', () => {
    const id = addSofa()
    const stuck = beginTxForTest()
    useDocStore.getState().transformFurniture(id, { x: 9 })
    handleKey(key('Escape'), ctx, registry)
    expect(isTxActive()).toBe(false)
    expect(getActiveLevelDoc().furniture[id]!.x).toBeCloseTo(2, 9) // reverted
    void stuck
  })
})

describe('M3 (0.3.0): Ctrl+A and zoom-to-selection', () => {
  it('Ctrl+A selects walls, openings, and furniture — never rooms or nodes', () => {
    useDocStore
      .getState()
      .addWallChain([vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
    const doc0 = getActiveLevelDoc()
    const wallId = Object.keys(doc0.walls)[0]! as never
    useDocStore.getState().addOpening({ kind: 'door', wallId, t: 0.5 })
    const sofa = addSofa(2, 1.5)
    handleKey(key('a', { ctrlKey: true }), ctx, registry)
    const sel = new Set(useUiStore.getState().selection)
    const doc = getActiveLevelDoc()
    expect(sel.size).toBe(4 + 1 + 1) // 4 walls + 1 door + 1 sofa
    expect(sel.has(sofa)).toBe(true)
    for (const id of Object.keys(doc.rooms)) expect(sel.has(id)).toBe(false)
    for (const id of Object.keys(doc.nodes)) expect(sel.has(id)).toBe(false)
  })

  it('Shift+2 zooms to the selection; no-op with nothing selected', () => {
    addSofa(2, 2)
    const far = addSofa(40, 40)
    const before = { ...useViewportStore.getState() }
    handleKey(key('2', { shiftKey: true }), ctx, registry) // nothing selected
    expect(useViewportStore.getState().tx).toBe(before.tx)
    useUiStore.getState().setSelection([far])
    handleKey(key('2', { shiftKey: true }), ctx, registry)
    const vp = useViewportStore.getState()
    // the selected far sofa is now centered: world(40,40) maps near screen center
    const cx = (40 * vp.k + vp.tx) / 1 // screenX = world.x * k + tx (y-up flip aside)
    expect(Math.abs(cx - vp.width / 2)).toBeLessThan(vp.width / 4)
  })
})

describe('M4 (0.3.0): commands, batch editing, context-menu guard', () => {
  it('a batched wall edit inside one tx is ONE undo entry across all walls', () => {
    useDocStore
      .getState()
      .addWallChain([vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
    const ids = Object.keys(getActiveLevelDoc().walls)
    const base = past()
    const tx = beginTxForTest()
    for (const id of ids) useDocStore.getState().updateWall(id as never, { thickness: 0.3 })
    commitTxForTest(tx)
    expect(past()).toBe(base + 1)
    for (const id of ids) {
      expect(getActiveLevelDoc().walls[id as never]!.thickness).toBeCloseTo(0.3, 9)
    }
    safeUndo()
    for (const id of ids) {
      expect(getActiveLevelDoc().walls[id as never]!.thickness).not.toBeCloseTo(0.3, 9)
    }
  })

  it('splitWallAt splits at the projected point; near-endpoint splits are rejected', async () => {
    const { splitWallAt } = await import('../commands')
    const r = useDocStore.getState().addWallSegment(vec(0, 0), vec(4, 0))
    expect(splitWallAt(ctx, r.wallId!, vec(1, 0.5))).toBe(true)
    expect(walls()).toBe(2)
    expect(
      Object.values(getActiveLevelDoc().nodes).some(
        (n) => Math.abs(n.x - 1) < 1e-6 && Math.abs(n.y) < 1e-6,
      ),
    ).toBe(true)
    const anyWall = Object.keys(getActiveLevelDoc().walls)[0]! as never
    expect(splitWallAt(ctx, anyWall, vec(0.0001, 0))).toBe(false)
  })

  it('an open context menu swallows keymap keys; Escape closes it', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    useUiStore.getState().setContextMenu({ x: 10, y: 10, world: vec(0, 0) })
    handleKey(key('Delete'), ctx, registry)
    expect(getActiveLevelDoc().furniture[id]).toBeDefined() // swallowed
    handleKey(key('Escape'), ctx, registry)
    expect(useUiStore.getState().contextMenu).toBeNull()
    expect(useUiStore.getState().selection).toEqual([id]) // Esc only closed the menu
    handleKey(key('Delete'), ctx, registry)
    expect(getActiveLevelDoc().furniture[id]).toBeUndefined()
  })

  it('pasteClipboard pastes at an explicit world point (context-menu Paste here)', async () => {
    const { copySelection, pasteClipboard } = await import('../commands')
    const id = addSofa(2, 2)
    useUiStore.getState().setSelection([id])
    expect(copySelection(ctx)).toBe(true)
    expect(pasteClipboard(ctx, vec(9, 9))).toBe(true)
    const pasted = useUiStore.getState().selection[0]! as FurnitureId
    expect(pasted).not.toBe(id)
    expect(getActiveLevelDoc().furniture[pasted]!.x).toBeCloseTo(9, 6)
    expect(getActiveLevelDoc().furniture[pasted]!.y).toBeCloseTo(9, 6)
  })
})

describe('M6 (0.3.0): annotations — measure→Enter, T tool, drags', () => {
  it('Enter on a frozen measurement persists it as a selected dimension (one entry)', () => {
    registry.switchTo(ctx, 'measure')
    const base = past()
    click(vec(0, 6))
    click(vec(4, 6))
    expect(tool().onKeyDown?.('Enter', ctx)).toBe(true)
    expect(past()).toBe(base + 1)
    const anns = Object.values(getActiveLevelDoc().annotations)
    expect(anns).toHaveLength(1)
    expect(anns[0]!.kind).toBe('dimension')
    expect(useUiStore.getState().selection).toEqual([anns[0]!.id])
    // Enter with nothing frozen bubbles
    expect(tool().onKeyDown?.('Enter', ctx)).toBe(false)
  })

  it('the T tool drops a placeholder label and selects it; stays armed', () => {
    switchTool('annotate-text')
    tool().onPointerDown(pe(vec(2, 2)), ctx)
    tool().onPointerDown(pe(vec(5, 5)), ctx)
    const anns = Object.values(getActiveLevelDoc().annotations)
    expect(anns).toHaveLength(2)
    expect(anns.every((a) => a.kind === 'label' && a.text === 'Text')).toBe(true)
    expect(useUiStore.getState().selection).toHaveLength(1) // the latest
    expect(useUiStore.getState().activeTool).toBe('annotate-text')
  })

  it('label drag translates it — one undo entry', () => {
    const id = useDocStore.getState().addLabel(vec(2, 2), 'Hello')!
    const base = past()
    useUiStore.getState().setSelection([id])
    drag(vec(2, 2), vec(4, 3))
    const ann = getActiveLevelDoc().annotations[id]!
    expect(ann.kind === 'label' && ann.x).toBeCloseTo(4, 6)
    expect(ann.kind === 'label' && ann.y).toBeCloseTo(3, 6)
    expect(past()).toBe(base + 1)
  })

  it('dimension drag slides the OFFSET only; endpoints never move', () => {
    const id = useDocStore.getState().addDimension(vec(0, 4), vec(4, 4), 0)!
    const base = past()
    drag(vec(2, 4), vec(2.2, 5)) // grab the line, pull perpendicular
    const ann = getActiveLevelDoc().annotations[id]!
    expect(ann.kind).toBe('dimension')
    if (ann.kind === 'dimension') {
      expect(ann.offset).toBeCloseTo(1, 6) // world +1 along +perp(a→b)
      expect(ann.a).toEqual({ x: 0, y: 4 })
      expect(ann.b).toEqual({ x: 4, y: 4 })
    }
    expect(past()).toBe(base + 1)
    // Esc mid-drag aborts the slide
    tool().onPointerDown(pe(vec(2, 5)), ctx)
    tool().onPointerMove(pe(vec(2, 8)), ctx)
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    const after = getActiveLevelDoc().annotations[id]!
    expect(after.kind === 'dimension' && after.offset).toBeCloseTo(1, 6)
  })

  it('annotations hit TOPMOST (a label over furniture wins the click)', () => {
    const sofa = addSofa(2, 2)
    const label = useDocStore.getState().addLabel(vec(2, 2), 'On top')!
    click(vec(2, 2))
    expect(useUiStore.getState().selection).toEqual([label])
    void sofa
  })

  it('Ctrl+A and the marquee include annotations', () => {
    const dim = useDocStore.getState().addDimension(vec(0, 5), vec(4, 5), 0)!
    const sofa = addSofa(2, 2)
    handleKey(key('a', { ctrlKey: true }), ctx, registry)
    expect(new Set(useUiStore.getState().selection)).toEqual(new Set([dim, sofa]))
    useUiStore.getState().clearSelection()
    tool().onPointerDown(pe(vec(-1, 4.5)), ctx)
    tool().onPointerMove(pe(vec(5, 5.5)), ctx) // box sweeps the dimension line
    expect(useUiStore.getState().selection).toEqual([dim])
    tool().onPointerUp(pe(vec(5, 5.5)), ctx)
  })

  it('Delete removes a selected annotation', () => {
    const id = useDocStore.getState().addLabel(vec(1, 1), 'Bye')!
    useUiStore.getState().setSelection([id])
    handleKey(key('Delete'), ctx, registry)
    expect(getActiveLevelDoc().annotations[id]).toBeUndefined()
  })

  it('Ctrl+A skips HIDDEN annotations (0.7.0 parity — no invisible Delete targets)', () => {
    const dim = useDocStore.getState().addDimension(vec(0, 5), vec(4, 5), 0)!
    const sofa = addSofa(2, 2)
    useAppSettings.getState().setShowAnnotations(false)
    handleKey(key('a', { ctrlKey: true }), ctx, registry)
    expect(useUiStore.getState().selection).toEqual([sofa])
    expect(getActiveLevelDoc().annotations[dim]).toBeDefined() // untouched
    useAppSettings.getState().setShowAnnotations(true)
  })
})

describe('area tool (0.7.0): trace, close, drag', () => {
  const anns = () => Object.values(getActiveLevelDoc().annotations)

  it('click-chain + first-vertex click closes: ONE area annotation, one undo entry, selected', () => {
    registry.switchTo(ctx, 'draw-area')
    const base = past()
    click(vec(0, 0))
    click(vec(3, 0))
    click(vec(3, 2))
    click(vec(0, 2))
    expect(anns()).toHaveLength(0) // trace is tool state, not doc state
    expect(past()).toBe(base)
    click(vec(0.05, 0.02)) // within the 10px close radius of the first vertex
    expect(anns()).toHaveLength(1)
    const ann = anns()[0]!
    expect(ann.kind).toBe('area')
    expect(ann.kind === 'area' && ann.points).toHaveLength(4)
    expect(past()).toBe(base + 1)
    expect(useUiStore.getState().selection).toEqual([ann.id])
  })

  it('Enter closes; Backspace pops a vertex; Esc clears the trace', () => {
    registry.switchTo(ctx, 'draw-area')
    click(vec(0, 0))
    click(vec(2, 0))
    click(vec(2, 2))
    click(vec(0, 2))
    expect(tool().onKeyDown?.('Backspace', ctx)).toBe(true) // drops (0,2)
    expect(tool().onKeyDown?.('Enter', ctx)).toBe(true)
    const ann = anns()[0]!
    expect(ann.kind === 'area' && ann.points).toHaveLength(3)

    // fresh trace: Esc clears without touching the doc
    click(vec(5, 5))
    click(vec(6, 5))
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    expect(anns()).toHaveLength(1) // still just the first one
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(false) // empty → bubbles
  })

  it('degenerate traces are rejected but consumed; auto re-enables hidden annotations', () => {
    registry.switchTo(ctx, 'draw-area')
    const base = past()
    click(vec(0, 0))
    click(vec(1, 0))
    click(vec(2, 0)) // collinear
    expect(tool().onKeyDown?.('Enter', ctx)).toBe(true)
    expect(anns()).toHaveLength(0)
    expect(past()).toBe(base) // rejected mutation records nothing

    useAppSettings.getState().setShowAnnotations(false)
    click(vec(0, 0))
    click(vec(2, 0))
    click(vec(2, 2))
    expect(tool().onKeyDown?.('Enter', ctx)).toBe(true)
    expect(anns()).toHaveLength(1)
    expect(useAppSettings.getState().showAnnotations).toBe(true) // self-healing
  })

  it('select-tool drag translates the polygon rigidly (edge grab, one entry)', () => {
    registry.switchTo(ctx, 'draw-area')
    click(vec(0, 0))
    click(vec(2, 0))
    click(vec(2, 2))
    click(vec(0, 2))
    expect(tool().onKeyDown?.('Enter', ctx)).toBe(true)
    const ann = anns()[0]!
    registry.switchTo(ctx, 'select')
    const base = past()
    drag(vec(1, 0), vec(1.5, 1)) // grab the bottom edge midpoint
    const moved = getActiveLevelDoc().annotations[ann.id]!
    expect(moved.kind === 'area' && moved.points[0]!.x).toBeCloseTo(0.5, 9)
    expect(moved.kind === 'area' && moved.points[0]!.y).toBeCloseTo(1, 9)
    // rigid: area unchanged (2×2 square)
    expect(moved.kind === 'area' && area(moved.points)).toBeCloseTo(4, 9)
    expect(past()).toBe(base + 1)
  })
})

describe('M8 (0.3.0): snap/grid hotkeys, help overlay, shortcut sheet', () => {
  it('S toggles snapping and G toggles the grid — device prefs, no undo entries', async () => {
    const { useAppSettings } = await import('../../store/appSettings')
    const base = past()
    const snapBefore = useAppSettings.getState().snapEnabled
    handleKey(key('s'), ctx, registry)
    expect(useAppSettings.getState().snapEnabled).toBe(!snapBefore)
    const gridBefore = useAppSettings.getState().showGrid
    handleKey(key('g'), ctx, registry)
    expect(useAppSettings.getState().showGrid).toBe(!gridBefore)
    expect(past()).toBe(base) // never undoable
    expect(usePersistStore.getState().dirty).toBe(false) // never dirties
    // restore
    useAppSettings.getState().setSnapEnabled(true)
    useAppSettings.getState().setShowGrid(true)
  })

  it("'?' opens the shortcut sheet; the modal guard then swallows canvas keys", () => {
    handleKey(key('?', { shiftKey: true }), ctx, registry)
    expect(useUiStore.getState().helpOpen).toBe(true)
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    handleKey(key('Delete'), ctx, registry)
    expect(getActiveLevelDoc().furniture[id]).toBeDefined() // swallowed
    useUiStore.getState().setHelpOpen(false)
  })

  it('the shortcut sheet covers the live binding set (drift pin)', async () => {
    const { SHORTCUT_SECTIONS } = await import('../../app/shortcuts')
    // EXACT tokens (substring matching let 'S' pass via 'Shift+1')
    const tokens = new Set(
      SHORTCUT_SECTIONS.flatMap((s) =>
        s.rows.flatMap((r) => r.keys.split(' / ').map((t) => t.trim())),
      ),
    )
    for (const k of [
      'V', 'W', 'D', 'N', 'M', 'T', 'A', 'S', 'G',
      'Ctrl+A', 'Ctrl+D', 'Ctrl+C', 'Ctrl+V', 'Ctrl+Z', 'Ctrl+Y',
      'Ctrl+N', 'Ctrl+O', 'Ctrl+S',
      'Shift+1', 'Shift+2', 'Shift+D', 'Shift+A', 'Shift+R',
      'Del', 'Enter', 'Backspace', 'R', 'F', '?', 'Esc', 'Arrows',
    ]) {
      expect(tokens).toContain(k)
    }
  })
})

describe('M9 (0.3.0): furniture resize handles + duplicate room', () => {
  it('corner drag resizes with the opposite corner ANCHORED — one undo entry', () => {
    const id = addSofa(2, 2) // 2.2×0.95 → corner (+,+) at (3.1, 2.475)
    useUiStore.getState().setSelection([id])
    const base = past()
    tool().onPointerDown(pe(vec(3.1, 2.475)), ctx)
    tool().onPointerMove(pe(vec(3.9, 3.525)), ctx) // stretch to 3×2
    tool().onPointerUp(pe(vec(3.9, 3.525)), ctx)
    const f = getActiveLevelDoc().furniture[id]!
    expect(f.size.w).toBeCloseTo(3, 6)
    expect(f.size.d).toBeCloseTo(2, 6)
    expect(f.x).toBeCloseTo(2.4, 6) // anchor (0.9,1.525) stayed put
    expect(f.y).toBeCloseTo(2.53, 2) // (1.525+3.525)/2, 1cm quantized
    expect(past()).toBe(base + 1)
  })

  it('resize respects rotation: a 90°-rotated item resizes in ITS frame', () => {
    const id = useDocStore.getState().addFurniture({
      catalogItemId: 'test-box',
      x: 0,
      y: 0,
      rotation: Math.PI / 2,
      size: { w: 2, d: 1, h: 1 },
    })
    useUiStore.getState().setSelection([id])
    // corner local (+1,+0.5) rotated 90° → world (−0.5, 1); anchor (0.5, −1)
    tool().onPointerDown(pe(vec(-0.5, 1)), ctx)
    tool().onPointerMove(pe(vec(-1, 2)), ctx)
    tool().onPointerUp(pe(vec(-1, 2)), ctx)
    const f = getActiveLevelDoc().furniture[id]!
    expect(f.size.w).toBeCloseTo(3, 6)
    expect(f.size.d).toBeCloseTo(1.5, 6)
    expect(f.x).toBeCloseTo(-0.25, 6)
    expect(f.y).toBeCloseTo(0.5, 6)
  })

  it('Esc aborts a resize; clamps hold at the floor', () => {
    const id = addSofa(2, 2)
    useUiStore.getState().setSelection([id])
    const pristine = useDocStore.getState().doc
    tool().onPointerDown(pe(vec(3.1, 2.475)), ctx)
    tool().onPointerMove(pe(vec(5, 5)), ctx)
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    expect(useDocStore.getState().doc).toBe(pristine)
    // clamp: drag the corner nearly onto the anchor
    tool().onPointerDown(pe(vec(3.1, 2.475)), ctx)
    tool().onPointerMove(pe(vec(1.0, 1.6)), ctx)
    tool().onPointerUp(pe(vec(1.0, 1.6)), ctx)
    const f = getActiveLevelDoc().furniture[id]!
    expect(f.size.d).toBeGreaterThanOrEqual(0.1)
    expect(f.size.w).toBeGreaterThanOrEqual(0.1)
  })

  it('Duplicate room clones walls, contents, and meta — fully disjoint', async () => {
    const { duplicateRoom } = await import('../commands')
    useDocStore
      .getState()
      .addWallChain([vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
    const room = Object.values(getActiveLevelDoc().rooms)[0]!
    useDocStore.getState().renameRoom(room.id, 'Bedroom')
    addSofa(2, 1.5)
    const base = past()
    expect(duplicateRoom(ctx, room.id)).toBe(true)
    expect(past()).toBe(base + 1) // ONE undo entry for the whole clone
    const d = getActiveLevelDoc()
    expect(walls()).toBe(8)
    expect(rooms()).toBe(2)
    expect(Object.keys(d.furniture)).toHaveLength(2)
    const names = Object.values(d.rooms).map((r) => r.name)
    expect(names.filter((n) => n === 'Bedroom')).toHaveLength(2)
    // disjoint: no shared nodes between the two cycles
    expect(Object.keys(d.nodes)).toHaveLength(8)
  })
})

describe('0.8.0 M2: room drag gesture', () => {
  const store = () => useDocStore.getState()
  const nodes = () => Object.values(getActiveLevelDoc().nodes)
  const nodeAt = (p: Vec2) => nodes().find((n) => Math.hypot(n.x - p.x, n.y - p.y) < 1e-6)
  const square = (x0 = 0, y0 = 0, s = 4) =>
    store().addWallChain([
      vec(x0, y0),
      vec(x0 + s, y0),
      vec(x0 + s, y0 + s),
      vec(x0, y0 + s),
      vec(x0, y0),
    ])
  /** Two adjacent 4x4 rooms sharing the x=4 divider. */
  const twoRooms = () => {
    store().addWallChain([vec(0, 0), vec(4, 0), vec(8, 0), vec(8, 4), vec(4, 4), vec(0, 4), vec(0, 0)])
    store().addWallSegment(vec(4, 0), vec(4, 4))
  }

  it('click-then-drag moves the room as one undo entry; selection survives', () => {
    square()
    click(vec(1, 1)) // click #1 selects the room
    const roomId = useUiStore.getState().selection[0]!
    expect(getActiveLevelDoc().rooms[roomId as never]).toBeDefined()
    const base = past()
    drag(vec(1, 1), vec(3, 1)) // drag #2 moves it by (2,0)
    expect(past()).toBe(base + 1)
    expect(nodeAt(vec(2, 0))).toBeDefined()
    expect(nodeAt(vec(6, 4))).toBeDefined()
    expect(nodeAt(vec(0, 0))).toBeUndefined()
    expect(useUiStore.getState().selection).toEqual([roomId])
    expect(useInteractionStore.getState().cursorHint).toBeNull() // reset after up
    expect(isTxActive()).toBe(false)
    safeUndo()
    expect(nodeAt(vec(0, 0))).toBeDefined()
  })

  it('furniture inside the room rides the drag', () => {
    square()
    const sofa = addSofa(2, 2)
    click(vec(1, 1))
    drag(vec(1, 1), vec(1, 3)) // delta (0,2)
    const f = getActiveLevelDoc().furniture[sofa]!
    expect(f.x).toBeCloseTo(2, 9)
    expect(f.y).toBeCloseTo(4, 9)
  })

  it('Shift on a selected room floor still marquees (additive), never drags', () => {
    square()
    click(vec(1, 1))
    const roomId = useUiStore.getState().selection[0]!
    const sofa = addSofa(2, 2)
    tool().onPointerDown(pe(vec(1, 1), { shift: true }), ctx)
    tool().onPointerMove(pe(vec(2.5, 2.5), { shift: true }), ctx)
    expect(useInteractionStore.getState().preview?.kind).toBe('marquee')
    expect(isTxActive()).toBe(false)
    tool().onPointerUp(pe(vec(2.5, 2.5), { shift: true }), ctx)
    expect(useUiStore.getState().selection).toContain(sofa)
    expect(nodeAt(vec(0, 0))).toBeDefined() // room did not move
    void roomId
  })

  it('Esc mid-drag rolls the tear back — doc and history untouched', () => {
    twoRooms()
    expect(walls()).toBe(7)
    const base = past()
    click(vec(6, 2)) // select the right room
    tool().onPointerDown(pe(vec(6, 2)), ctx)
    tool().onPointerMove(pe(vec(7.5, 2)), ctx) // past slop → tear + live move
    expect(walls()).toBe(8) // torn duplicate exists mid-gesture
    expect(isTxActive()).toBe(true)
    expect(tool().onKeyDown?.('Escape', ctx)).toBe(true)
    expect(walls()).toBe(7)
    expect(nodeAt(vec(8, 0))).toBeDefined() // right room back in place
    expect(past()).toBe(base)
    expect(isTxActive()).toBe(false)
  })

  it('dragging a room against another welds through the gesture; undo restores', () => {
    square() // A: 0..4
    square(6, 0) // B: 6..10
    expect(walls()).toBe(8)
    click(vec(7, 2)) // select B
    drag(vec(7, 2), vec(5, 2)) // B moves by (-2,0): edge-to-edge with A
    expect(walls()).toBe(7) // welded into one shared wall
    expect(rooms()).toBe(2)
    safeUndo()
    expect(walls()).toBe(8)
    expect(nodeAt(vec(6, 0))).toBeDefined()
  })

  it('dragging out and back to the start is a topological no-op', () => {
    twoRooms()
    click(vec(6, 2))
    tool().onPointerDown(pe(vec(6, 2)), ctx)
    tool().onPointerMove(pe(vec(6.1, 2.1)), ctx)
    tool().onPointerMove(pe(vec(8, 2)), ctx) // out…
    tool().onPointerMove(pe(vec(6, 2)), ctx) // …and exactly back
    tool().onPointerUp(pe(vec(6, 2)), ctx)
    expect(walls()).toBe(7) // tear deduped away
    expect(rooms()).toBe(2)
    expect(nodeAt(vec(8, 0))).toBeDefined()
    expect(isTxActive()).toBe(false)
  })

  it('tool deactivation mid-room-drag aborts cleanly', () => {
    square()
    click(vec(1, 1))
    tool().onPointerDown(pe(vec(1, 1)), ctx)
    tool().onPointerMove(pe(vec(3, 3)), ctx)
    expect(isTxActive()).toBe(true)
    registry.switchTo(ctx, 'draw-wall')
    expect(isTxActive()).toBe(false)
    expect(nodeAt(vec(0, 0))).toBeDefined() // restored
    registry.switchTo(ctx, 'select')
  })
})

describe('0.8.0 M3: room drag snapping', () => {
  const store = () => useDocStore.getState()
  const nodes = () => Object.values(getActiveLevelDoc().nodes)
  const nodeAt = (p: Vec2) => nodes().find((n) => Math.hypot(n.x - p.x, n.y - p.y) < 1e-6)
  const square = (x0 = 0, y0 = 0, s = 4) =>
    store().addWallChain([
      vec(x0, y0),
      vec(x0 + s, y0),
      vec(x0 + s, y0 + s),
      vec(x0, y0 + s),
      vec(x0, y0),
    ])
  const xWallsAt = (x: number) =>
    Object.values(getActiveLevelDoc().walls).filter(
      (w) =>
        Math.abs(getActiveLevelDoc().nodes[w.a]!.x - x) < 1e-6 &&
        Math.abs(getActiveLevelDoc().nodes[w.b]!.x - x) < 1e-6,
    )

  it('roomSnapCandidates: corner-node points carry the weld-corner display; guides the centerline', async () => {
    const { collectRoomRig, captureRigStarts } = await import('../../model/mutations/roomRig')
    const { roomSnapCandidates } = await import('../snap/candidates')
    square() // stationary A
    square(6, 1, 2) // B: 6..8 × 1..3
    const b = Object.values(getActiveLevelDoc().rooms).find((r) =>
      r.wallCycle.some((id) => {
        const w = getActiveLevelDoc().walls[id]!
        return getActiveLevelDoc().nodes[w.a]!.x >= 6
      }),
    )!
    const info = collectRoomRig(getActiveLevelDoc(), b.id)!
    const starts = captureRigStarts(getActiveLevelDoc(), info.rig)
    const grab = vec(7, 2)
    const cands = roomSnapCandidates(getActiveLevelDoc(), info.rig, starts, grab)
    // corner (6,1) offset (−1,−1): stationary node (4,0) → grab point (5,1)
    const corner = cands.find(
      (c) =>
        c.kind === 'node' &&
        Math.abs(c.point.x - 5) < 1e-9 &&
        Math.abs(c.point.y - 1) < 1e-9,
    )
    expect(corner).toBeDefined()
    expect(corner!.kind === 'node' && corner!.display).toEqual({ x: 4, y: 0 })
    // B left wall centerline x=6 (offset −1) onto A right wall x=4 → value 5
    const guide = cands.find(
      (c) => c.kind === 'guideX' && Math.abs(c.value - 5) < 1e-9,
    )
    expect(guide).toBeDefined()
    expect(guide!.kind === 'guideX' && guide!.display).toBe(4)
    // no candidates target the rig's own geometry
    expect(
      cands.some((c) => c.kind === 'node' && info.rig.nodeIds.includes(c.nodeId as never)),
    ).toBe(false)
  })

  it('corner snap welds a near-miss drop edge-to-edge', () => {
    square() // A: 0..4
    square(6, 0.3) // B: 6..10 × 0.3..4.3 — misaligned by 0.3
    expect(walls()).toBe(8)
    click(vec(7, 2.3)) // select B
    tool().onPointerDown(pe(vec(7, 2.3)), ctx)
    tool().onPointerMove(pe(vec(6.5, 2.2)), ctx)
    tool().onPointerMove(pe(vec(5.03, 2.04)), ctx) // 5cm off the exact dock
    const snap = useInteractionStore.getState().snap
    expect(snap?.primary?.kind).toBe('node') // corner candidate captured
    tool().onPointerUp(pe(vec(5.03, 2.04)), ctx)
    expect(walls()).toBe(7) // welded despite the near-miss
    expect(rooms()).toBe(2)
    expect(nodeAt(vec(4, 0))).toBeDefined()
    expect(nodeAt(vec(4, 4))).toBeDefined()
    expect(nodeAt(vec(4.03, 0.04))).toBeUndefined()
  })

  it('centerline guide makes a collinear dock exact: T-split + shared fragment', () => {
    square() // A: 0..4
    store().addWallChain([vec(6, 1), vec(9, 1), vec(9, 3), vec(6, 3), vec(6, 1)])
    click(vec(7, 2)) // select B
    tool().onPointerDown(pe(vec(7, 2)), ctx)
    tool().onPointerMove(pe(vec(6.5, 2)), ctx)
    tool().onPointerMove(pe(vec(4.97, 2.06)), ctx) // 3cm off collinear
    const snap = useInteractionStore.getState().snap
    expect(snap?.axes?.x?.kind === 'guideX' && snap.axes.x.display).toBe(4)
    tool().onPointerUp(pe(vec(4.97, 2.06)), ctx)
    expect(xWallsAt(4)).toHaveLength(3) // [0,1.06] [1.06,3.06] shared, [3.06,4]
    expect(rooms()).toBe(2)
  })

  it('Ctrl suspends room snapping — the near-miss stays a near-miss', () => {
    square()
    square(6, 0.3)
    click(vec(7, 2.3))
    tool().onPointerDown(pe(vec(7, 2.3), { ctrl: true }), ctx)
    tool().onPointerMove(pe(vec(6.5, 2.2), { ctrl: true }), ctx)
    tool().onPointerMove(pe(vec(5.03, 2.04), { ctrl: true }), ctx)
    tool().onPointerUp(pe(vec(5.03, 2.04), { ctrl: true }), ctx)
    expect(walls()).toBe(8) // no weld
    expect(rooms()).toBe(2)
    expect(nodeAt(vec(4.03, 0.04))).toBeDefined() // raw drop position kept
  })
})

describe('0.8.0 M4: room rotation', () => {
  const store = () => useDocStore.getState()
  const nodeAt = (p: Vec2) =>
    Object.values(getActiveLevelDoc().nodes).find((n) => Math.hypot(n.x - p.x, n.y - p.y) < 1e-4)
  const wallBetween = (p: Vec2, q: Vec2) =>
    Object.values(getActiveLevelDoc().walls).find((w) => {
      const na = getActiveLevelDoc().nodes[w.a]!
      const nb = getActiveLevelDoc().nodes[w.b]!
      return (
        (Math.hypot(na.x - p.x, na.y - p.y) < 1e-4 && Math.hypot(nb.x - q.x, nb.y - q.y) < 1e-4) ||
        (Math.hypot(na.x - q.x, na.y - q.y) < 1e-4 && Math.hypot(nb.x - p.x, nb.y - p.y) < 1e-4)
      )
    })
  const rect = () =>
    store().addWallChain([vec(0, 0), vec(4, 0), vec(4, 2), vec(0, 2), vec(0, 0)])

  it('R rotates a sole-selected room 90° about its pivot — one undo entry', () => {
    rect()
    const bottom = wallBetween(vec(0, 0), vec(4, 0))!
    const doorId = store().addOpening({ kind: 'door', wallId: bottom.id, t: 0.25 })!
    const sofa = addSofa(1, 1)
    click(vec(3.2, 1.6)) // room floor, clear of the sofa
    const base = past()
    handleKey(key('r'), ctx, registry)
    expect(past()).toBe(base + 1)
    // 4x2 rect about pivot (2,1) → corners (3,-1),(3,3),(1,3),(1,-1)
    for (const p of [vec(3, -1), vec(3, 3), vec(1, 3), vec(1, -1)]) {
      expect(nodeAt(p), `corner ${p.x},${p.y}`).toBeDefined()
    }
    expect(getActiveLevelDoc().openings[doorId]).toBeDefined()
    expect(getActiveLevelDoc().openings[doorId]!.wallId).toBe(bottom.id)
    expect(getActiveLevelDoc().openings[doorId]!.t).toBeCloseTo(0.25, 6)
    const f = getActiveLevelDoc().furniture[sofa]!
    expect(f.x).toBeCloseTo(2, 6)
    expect(f.y).toBeCloseTo(0, 6)
    expect(f.rotation).toBeCloseTo(Math.PI / 2, 9)
    safeUndo()
    expect(nodeAt(vec(0, 0))).toBeDefined()
  })

  it('Shift+R rotates −90°', () => {
    rect()
    click(vec(1, 1))
    handleKey(key('R', { shiftKey: true }), ctx, registry)
    // −90°: (0,0) rel (−2,−1) → (y,−x) = (−1,2) → (1,3)… full set mirrored
    for (const p of [vec(1, 3), vec(1, -1), vec(3, -1), vec(3, 3)]) {
      expect(nodeAt(p), `corner ${p.x},${p.y}`).toBeDefined()
    }
  })

  it('handle drag: 47° raw snaps to the 45° detent; Ctrl keeps it free', () => {
    rect()
    click(vec(1, 1))
    // pivot (2,1); handle at (2, 0.64) at k=100
    const grabAt = (deg: number, r = 0.36) =>
      vec(2 + r * Math.cos(((deg - 90) * Math.PI) / 180), 1 + r * Math.sin(((deg - 90) * Math.PI) / 180))
    tool().onPointerDown(pe(vec(2, 0.64)), ctx)
    tool().onPointerMove(pe(grabAt(47)), ctx)
    tool().onPointerUp(pe(grabAt(47)), ctx)
    // detent: 47° → 45°; corner (0,0) rel (−2,−1) rot45 → (2−0.7071, 1−2.1213)
    expect(nodeAt(vec(2 - 0.70711, 1 - 2.12132))).toBeDefined()
    safeUndo()
    // Ctrl-free: exact 47°
    click(vec(1, 1))
    tool().onPointerDown(pe(vec(2, 0.64)), ctx)
    tool().onPointerMove(pe(grabAt(47), { ctrl: true }), ctx)
    tool().onPointerUp(pe(grabAt(47), { ctrl: true }), ctx)
    const c = Math.cos((47 * Math.PI) / 180)
    const s = Math.sin((47 * Math.PI) / 180)
    expect(nodeAt(vec(2 + (-2 * c - -1 * s), 1 + (-2 * s + -1 * c)))).toBeDefined()
  })

  it('a plain handle click leaves no undo entry and no doc change', () => {
    rect()
    click(vec(1, 1))
    const base = past()
    tool().onPointerDown(pe(vec(2, 0.64)), ctx)
    tool().onPointerUp(pe(vec(2, 0.64)), ctx)
    expect(past()).toBe(base)
    expect(nodeAt(vec(0, 0))).toBeDefined()
    expect(walls()).toBe(4)
    expect(isTxActive()).toBe(false)
  })

  it('rotating a square room beside its neighbor stays topology-stable via R', () => {
    store().addWallChain([vec(0, 0), vec(4, 0), vec(8, 0), vec(8, 4), vec(4, 4), vec(0, 4), vec(0, 0)])
    store().addWallSegment(vec(4, 0), vec(4, 4))
    const divider = wallBetween(vec(4, 0), vec(4, 4))!
    const doorId = store().addOpening({ kind: 'door', wallId: divider.id, t: 0.5 })!
    click(vec(6, 2)) // select the right room
    const base = past()
    handleKey(key('r'), ctx, registry)
    expect(past()).toBe(base + 1)
    expect(walls()).toBe(7) // square maps onto itself; tear rewelds
    expect(rooms()).toBe(2)
    expect(getActiveLevelDoc().openings[doorId]).toBeDefined()
    expect(getActiveLevelDoc().openings[doorId]!.wallId).toBe(divider.id)
    safeUndo()
    expect(walls()).toBe(7)
  })
})
