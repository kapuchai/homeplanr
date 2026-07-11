import { beforeEach, describe, expect, it } from 'vitest'
import { docTemporal, useDocStore } from './docStore'
import { abortTx, beginTx, canRedo, canUndo, clearHistory, commitTx, isTxActive, safeUndo } from './transactions'
import { getDerived, resetDerivedForTests } from './derived'
import { parseDocument, serializeDocument, ForwardVersionError, InvalidDocumentError } from './persistence/serialize'
import { decideRecovery, decodeRecovery, encodeRecovery } from './persistence/recovery'
import { emptyDocument } from '../model/types'
import { newProjectId, type NodeId, type WallId } from '../model/ids'
import { vec } from '../geometry/vec'

const past = () => docTemporal.getState().pastStates.length

beforeEach(() => {
  if (isTxActive()) abortTx()
  useDocStore.setState({ doc: emptyDocument(newProjectId(), 'test', '2026-07-11T00:00:00.000Z') })
  clearHistory()
  resetDerivedForTests()
})

const drawSquare = (size = 4) =>
  useDocStore
    .getState()
    .addWallChain([vec(0, 0), vec(size, 0), vec(size, size), vec(0, size), vec(0, 0)])

describe('docStore composition (pinned middleware stack)', () => {
  it('actions mutate through immer and produce a new doc identity per commit', () => {
    const before = useDocStore.getState().doc
    drawSquare()
    const after = useDocStore.getState().doc
    expect(after).not.toBe(before)
    expect(Object.keys(after.walls)).toHaveLength(4)
    expect(Object.keys(after.rooms)).toHaveLength(1)
  })

  it('subscribeWithSelector fires exactly once per committed mutation', () => {
    let fires = 0
    const unsub = useDocStore.subscribe(
      (s) => s.doc,
      () => fires++,
    )
    drawSquare()
    expect(fires).toBe(1)
    useDocStore.getState().addFurniture({
      catalogItemId: 'sofa-3',
      x: 1,
      y: 1,
      size: { w: 2.2, d: 0.95, h: 0.85 },
    })
    expect(fires).toBe(2)
    unsub()
  })

  it('no-op mutations add no history entry (zundo equality on .doc)', () => {
    drawSquare()
    const entries = past()
    useDocStore.getState().renameRoom('r_missing' as never, 'X') // missing id → no change
    expect(past()).toBe(entries)
  })

  it('undo restores the EXACT prior doc reference', () => {
    drawSquare()
    const docAfterSquare = useDocStore.getState().doc
    useDocStore.getState().addFurniture({
      catalogItemId: 'bed-double',
      x: 2,
      y: 2,
      size: { w: 1.67, d: 2.12, h: 1.0 },
    })
    safeUndo()
    expect(useDocStore.getState().doc).toBe(docAfterSquare)
    expect(canRedo()).toBe(true)
  })
})

describe('transactions', () => {
  it('N live mutations inside a tx collapse into exactly one history entry', () => {
    drawSquare()
    const base = past()
    const nodeId = Object.keys(useDocStore.getState().doc.nodes)[0]! as NodeId
    beginTx()
    for (let i = 1; i <= 5; i++) {
      useDocStore.getState().moveNode(nodeId, vec(-i * 0.1, -i * 0.1), { mode: 'live' })
    }
    useDocStore.getState().moveNode(nodeId, vec(-0.5, -0.5), { mode: 'commit' })
    commitTx()
    expect(past()).toBe(base + 1)
    const n = useDocStore.getState().doc.nodes[nodeId]!
    expect(n.x).toBeCloseTo(-0.5, 9)
    // one undo returns to the pre-drag square
    safeUndo()
    expect(useDocStore.getState().doc.nodes[nodeId]!.x).toBeCloseTo(0, 9)
  })

  it('abortTx restores the pristine pre-drag doc reference, no entry', () => {
    drawSquare()
    const pristine = useDocStore.getState().doc
    const base = past()
    const nodeId = Object.keys(pristine.nodes)[0]! as NodeId
    beginTx()
    useDocStore.getState().moveNode(nodeId, vec(9, 9), { mode: 'live' })
    abortTx()
    expect(useDocStore.getState().doc).toBe(pristine)
    expect(past()).toBe(base)
  })

  it('safeUndo is ignored while a tx is active', () => {
    drawSquare()
    const nodeId = Object.keys(useDocStore.getState().doc.nodes)[0]! as NodeId
    beginTx()
    useDocStore.getState().moveNode(nodeId, vec(1, 1), { mode: 'live' })
    const during = useDocStore.getState().doc
    safeUndo()
    expect(useDocStore.getState().doc).toBe(during)
    abortTx()
  })

  it('commit/abort with no active tx are no-ops (Esc-then-pointer-up)', () => {
    drawSquare()
    const doc = useDocStore.getState().doc
    const base = past()
    commitTx()
    abortTx()
    expect(useDocStore.getState().doc).toBe(doc)
    expect(past()).toBe(base)
  })

  it('drag across a wall: commit-mode split happens AND history grows by exactly 1', () => {
    useDocStore.getState().addWallSegment(vec(-2, 0), vec(2, 0))
    useDocStore.getState().addWallSegment(vec(0, 2), vec(0, 4))
    const base = past()
    // drag the (0,2) node down onto/through the horizontal wall
    const doc = useDocStore.getState().doc
    const dragged = Object.values(doc.nodes).find((n) => n.x === 0 && n.y === 2)!
    beginTx()
    useDocStore.getState().moveNode(dragged.id, vec(0, 1), { mode: 'live' })
    useDocStore.getState().moveNode(dragged.id, vec(0, 0.004), { mode: 'live' })
    useDocStore.getState().moveNode(dragged.id, vec(0, 0.004), { mode: 'commit' })
    commitTx()
    expect(past()).toBe(base + 1)
    // the vertical wall's endpoint welded onto the horizontal wall → T-split
    expect(Object.keys(useDocStore.getState().doc.walls)).toHaveLength(3)
    expect(canUndo()).toBe(true)
  })
})

describe('derived geometry — per-entity reference stability', () => {
  it('same doc → same derived object (WeakMap)', () => {
    drawSquare()
    const doc = useDocStore.getState().doc
    expect(getDerived(doc)).toBe(getDerived(doc))
  })

  it('moving an isolated wall keeps square solids and room by reference', () => {
    drawSquare()
    useDocStore.getState().addWallSegment(vec(10, 10), vec(14, 10))
    const doc1 = useDocStore.getState().doc
    const d1 = getDerived(doc1)
    const squareWallIds = Object.values(doc1.rooms)[0]!.wallCycle
    const isolated = (Object.keys(doc1.walls) as WallId[]).find(
      (id) => !squareWallIds.includes(id),
    )!
    const roomId = Object.values(doc1.rooms)[0]!.id

    // move one endpoint of the isolated wall
    const isolatedNode = doc1.walls[isolated]!.a
    useDocStore.getState().moveNode(isolatedNode, vec(10, 11))
    const doc2 = useDocStore.getState().doc
    const d2 = getDerived(doc2)

    for (const wid of squareWallIds) {
      expect(d2.wallSolids[wid], `solid ${wid}`).toBe(d1.wallSolids[wid])
      expect(d2.outlines.wallPolygons[wid], `poly ${wid}`).toBe(d1.outlines.wallPolygons[wid])
    }
    expect(d2.wallSolids[isolated]).not.toBe(d1.wallSolids[isolated])
    expect(d2.rooms[roomId]).toBe(d1.rooms[roomId])
  })

  it('moving a chain endpoint invalidates the incident wall + its junction partner only', () => {
    // 4-wall chain: moving the first node changes w1 (incident) and w2
    // (junction partner — its miter at the shared node depends on w1's
    // direction); w3 and w4 must keep reference identity.
    useDocStore
      .getState()
      .addWallChain([vec(0, 0), vec(2, 0), vec(4, 0), vec(6, 0), vec(8, 0)])
    const doc1 = useDocStore.getState().doc
    const d1 = getDerived(doc1)
    const endpoint = Object.values(doc1.nodes).find((n) => n.x === 0 && n.y === 0)!
    useDocStore.getState().moveNode(endpoint.id, vec(0, -0.7))
    const doc2 = useDocStore.getState().doc
    const d2 = getDerived(doc2)
    const changed = (Object.keys(doc2.walls) as WallId[]).filter(
      (wid) => d2.wallSolids[wid] !== d1.wallSolids[wid],
    )
    expect(changed).toHaveLength(2)
    // and specifically the two walls nearest the moved endpoint
    const near = new Set(
      Object.values(doc2.walls)
        .filter((w) =>
          [w.a, w.b].some((n) => {
            const node = doc2.nodes[n]!
            return node.x <= 4 && Math.abs(node.y) < 1
          }),
        )
        .map((w) => w.id),
    )
    for (const wid of changed) expect(near.has(wid)).toBe(true)
  })

  it('moving a square corner invalidates all four walls (all are junction partners) and the room', () => {
    drawSquare()
    const doc1 = useDocStore.getState().doc
    const d1 = getDerived(doc1)
    const corner = Object.values(doc1.nodes).find((n) => n.x === 0 && n.y === 0)!
    useDocStore.getState().moveNode(corner.id, vec(-0.3, -0.3))
    const doc2 = useDocStore.getState().doc
    const d2 = getDerived(doc2)
    // every square wall's miter moves (each shares a node with an incident wall)
    for (const wid of Object.keys(doc2.walls) as WallId[]) {
      expect(d2.wallSolids[wid]).not.toBe(d1.wallSolids[wid])
    }
    const roomId = Object.values(doc2.rooms)[0]!.id
    expect(d2.rooms[roomId]).not.toBe(d1.rooms[roomId])
  })
})

describe('serialization', () => {
  it('roundtrip: parse(serialize(doc)) deep-equals modulo updatedAt, not healed', () => {
    drawSquare()
    useDocStore.getState().addOpening({
      kind: 'door',
      wallId: Object.keys(useDocStore.getState().doc.walls)[0]! as WallId,
      t: 0.5,
    })
    useDocStore.getState().addFurniture({
      catalogItemId: 'sofa-3',
      x: 2,
      y: 2,
      size: { w: 2.2, d: 0.95, h: 0.85 },
    })
    const doc = useDocStore.getState().doc
    const { doc: parsed, warnings, healed } = parseDocument(
      serializeDocument(doc, '2026-07-11T12:00:00.000Z'),
    )
    expect(warnings).toHaveLength(0)
    expect(healed).toBe(false)
    expect(parsed).toEqual({ ...doc, updatedAt: '2026-07-11T12:00:00.000Z' })
  })

  it('corrupted references are pruned with warnings and healed=true', () => {
    drawSquare()
    const doc = useDocStore.getState().doc
    const json = JSON.parse(serializeDocument(doc))
    json.openings['o_ghost'] = { kind: 'door', wallId: 'w_missing', t: 0.5, width: 0.9, height: 2 }
    json.nodes['n_bad'] = { x: 'NaN?', y: 0 }
    const r = parseDocument(JSON.stringify(json))
    expect(r.warnings.length).toBeGreaterThanOrEqual(2)
    expect(r.healed).toBe(true)
    expect(Object.keys(r.doc.openings)).toHaveLength(0)
  })

  it('forward schemaVersion refuses with ForwardVersionError', () => {
    const json = serializeDocument(useDocStore.getState().doc).replace(
      '"schemaVersion": 1',
      '"schemaVersion": 99',
    )
    expect(() => parseDocument(json)).toThrow(ForwardVersionError)
  })

  it('garbage input throws InvalidDocumentError', () => {
    expect(() => parseDocument('not json at all')).toThrow(InvalidDocumentError)
    expect(() => parseDocument('[1,2,3]')).toThrow(InvalidDocumentError)
    expect(() => parseDocument('{"hello":"world"}')).toThrow(InvalidDocumentError)
  })
})

describe('crash recovery decisions', () => {
  const blob = (filePath: string | null, savedAt: number) => ({
    v: 1 as const,
    filePath,
    docId: 'p_x',
    savedAt,
    doc: emptyDocument('p_x', 'X', '2026-07-11T00:00:00.000Z'),
  })

  it('never-saved project → offer-unsaved', () => {
    expect(decideRecovery(blob(null, 100), null)).toEqual({ action: 'offer-unsaved' })
    expect(decideRecovery(blob(null, 100), 99999)).toEqual({ action: 'offer-unsaved' })
  })

  it('recovery newer than file → offer-restore with the path', () => {
    expect(decideRecovery(blob('/a.homeplanr', 2000), 1000)).toEqual({
      action: 'offer-restore',
      filePath: '/a.homeplanr',
    })
  })

  it('file newer than recovery, or file missing → discard', () => {
    expect(decideRecovery(blob('/a.homeplanr', 1000), 2000)).toEqual({ action: 'discard' })
    expect(decideRecovery(blob('/a.homeplanr', 1000), null)).toEqual({ action: 'discard' })
  })

  it('encode/decode roundtrip; garbage decodes to null', () => {
    const b = blob('/a.homeplanr', 123)
    const decoded = decodeRecovery(encodeRecovery(b))
    expect(decoded?.filePath).toBe('/a.homeplanr')
    expect(decoded?.savedAt).toBe(123)
    expect(decodeRecovery('junk')).toBeNull()
    expect(decodeRecovery(null)).toBeNull()
    expect(decodeRecovery('{"v":2}')).toBeNull()
  })
})
