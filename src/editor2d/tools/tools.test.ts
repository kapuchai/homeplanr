import { beforeEach, describe, expect, it } from 'vitest'
import { useDocStore, docTemporal } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { useConfirmStore } from '../../app/confirmStore'
import { useInteractionStore } from '../session/interactionStore'
import { useViewportStore } from '../viewport/viewportStore'
import { getDerived, resetDerivedForTests } from '../../store/derived'
import { abortTx, clearHistory, isTxActive } from '../../store/transactions'
import { createToolRegistry } from './toolRegistry'
import { handleKey, handleKeyUp, flushNudgeForTests, type KeyInput } from './keymap'
import type { EditorPointerEvent, ToolContext } from './toolTypes'
import { emptyDocument } from '../../model/types'
import { newProjectId, type FurnitureId } from '../../model/ids'
import { vec, type Vec2 } from '../../geometry/vec'

/**
 * Tool state machines driven by scripted event sequences against the REAL
 * document store — the plan's M3a regression net.
 */
const registry = createToolRegistry()
const ctx: ToolContext = {
  doc: () => useDocStore.getState().doc,
  derived: () => getDerived(useDocStore.getState().doc),
  actions: () => useDocStore.getState(),
  ui: () => useUiStore.getState(),
  interaction: () => useInteractionStore.getState(),
  pxToWorld: () => 1 / useViewportStore.getState().k,
}

const past = () => docTemporal.getState().pastStates.length
const walls = () => Object.keys(useDocStore.getState().doc.walls).length
const rooms = () => Object.keys(useDocStore.getState().doc.rooms).length

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
  if (isTxActive()) abortTx()
  registry.switchTo(ctx, 'select')
  useDocStore.setState({ doc: emptyDocument(newProjectId(), 'test', '2026-07-11T00:00:00.000Z') })
  clearHistory()
  resetDerivedForTests()
  useUiStore.getState().clearSelection()
  useUiStore.getState().setHovered(null)
  useUiStore.getState().setOptionsOpen(false)
  if (useConfirmStore.getState().pending) useConfirmStore.getState().resolve('')
  useViewportStore.setState({ k: 100, tx: 0, ty: 0, width: 800, height: 600 })
  useInteractionStore.getState().clear()
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
    const f = useDocStore.getState().doc.furniture[id]!
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
    const fa = useDocStore.getState().doc.furniture[a]!
    const fb = useDocStore.getState().doc.furniture[b]!
    expect(fa.x).toBeCloseTo(2.5, 6)
    expect(fa.y).toBeCloseTo(3, 6)
    expect(fb.x).toBeCloseTo(6.5, 6)
    expect(fb.y).toBeCloseTo(3, 6)
  })

  it('node drag onto another node merges them (drop target survives)', () => {
    useDocStore.getState().addWallSegment(vec(0, 0), vec(4, 0))
    useDocStore.getState().addWallSegment(vec(4, 0), vec(4, 3))
    useDocStore.getState().addWallSegment(vec(0, 3), vec(0, 5))
    const doc = useDocStore.getState().doc
    const dangling = Object.values(doc.nodes).find((n) => n.x === 0 && n.y === 3)!
    const target = Object.values(doc.nodes).find((n) => n.x === 0 && n.y === 0)!
    // select the dangling node's wall so the node becomes hittable
    const wall = Object.values(doc.walls).find((w) => w.a === dangling.id || w.b === dangling.id)!
    useUiStore.getState().setSelection([wall.id])
    const base = past()
    drag(vec(0, 3), vec(0.02, 0.03)) // drop near the target node → node snap → merge
    expect(useDocStore.getState().doc.nodes[dangling.id]).toBeUndefined()
    expect(useDocStore.getState().doc.nodes[target.id]).toBeDefined()
    expect(past()).toBe(base + 1)
  })

  it('wall drag translates perpendicular and keeps openings (one entry)', () => {
    const r = useDocStore.getState().addWallSegment(vec(0, 0), vec(6, 0))
    const opId = useDocStore.getState().addOpening({ kind: 'door', wallId: r.wallId!, t: 0.5 })!
    useUiStore.getState().setSelection([r.wallId!])
    const base = past()
    // grab clear of the door span [2.55, 3.45] so the WALL is the top hit
    drag(vec(1.2, 0), vec(1.2, 1.5))
    const doc = useDocStore.getState().doc
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
    const op = useDocStore.getState().doc.openings[opId]!
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
    const roomId = Object.keys(useDocStore.getState().doc.rooms)[0]!
    const wallId = Object.keys(useDocStore.getState().doc.walls)[0]!
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
    expect(useDocStore.getState().doc.furniture[a]!.rotation).toBeCloseTo(Math.PI / 2, 9)
    expect(useDocStore.getState().doc.furniture[b]!.rotation).toBeCloseTo(Math.PI / 2, 9)
    expect(past()).toBe(base + 1)
  })

  it('Ctrl+D duplicates at +0.25 and selects the copies', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    handleKey(key('d', { ctrlKey: true }), ctx, registry)
    const sel = useUiStore.getState().selection
    expect(sel).toHaveLength(1)
    expect(sel[0]).not.toBe(id)
    const copy = useDocStore.getState().doc.furniture[sel[0]! as FurnitureId]!
    expect(copy.x).toBeCloseTo(2.25, 9)
  })

  it('arrow nudges coalesce into a single undo entry', () => {
    const id = addSofa()
    useUiStore.getState().setSelection([id])
    const base = past()
    handleKey(key('ArrowRight'), ctx, registry)
    handleKey(key('ArrowRight'), ctx, registry)
    handleKey(key('ArrowDown', { shiftKey: true }), ctx, registry)
    flushNudgeForTests()
    expect(past()).toBe(base + 1)
    const f = useDocStore.getState().doc.furniture[id]!
    expect(f.x).toBeCloseTo(2.02, 9)
    expect(f.y).toBeCloseTo(2.1, 9)
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
    expect(useDocStore.getState().doc.furniture[id]).toBeDefined()
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
    expect(useDocStore.getState().doc.furniture[id]).toBeDefined()
    // the dialog owns Escape via its own listener — the keymap must not act
    handleKey(key('Escape'), ctx, registry)
    expect(useUiStore.getState().optionsOpen).toBe(true)
    expect(useUiStore.getState().selection).toEqual([id])
    useUiStore.getState().setOptionsOpen(false)
    handleKey(key('w'), ctx, registry)
    expect(useUiStore.getState().activeTool).toBe('draw-wall')
  })
})
