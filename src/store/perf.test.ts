import { describe, expect, it } from 'vitest'
import { testLevelDoc } from '../test/fixtureDoc'
import { type LevelDoc } from '../model/types'
import { addWallChain } from '../model/mutations/walls'
import { addOpening } from '../model/mutations/openings'
import { addFurniture } from '../model/mutations/furniture'
import { getDerived, resetDerivedForTests } from './derived'
import { buildPrismMeshData } from '../scene3d/mesh/prismGeometry'
import { vec } from '../geometry/vec'

/**
 * Perf budgets (plan-pinned, with CI-loose thresholds — local numbers are
 * far lower; these exist to catch order-of-magnitude regressions, not to
 * benchmark).
 */
function bigFixture(): LevelDoc {
  const doc = testLevelDoc('p_perf', 'perf')
  // 10×5 grid of 2m rooms ⇒ >100 walls
  for (let gx = 0; gx < 10; gx++) {
    for (let gy = 0; gy < 5; gy++) {
      addWallChain(
        doc,
        [
          vec(gx * 2, gy * 2),
          vec(gx * 2 + 2, gy * 2),
          vec(gx * 2 + 2, gy * 2 + 2),
          vec(gx * 2, gy * 2 + 2),
          vec(gx * 2, gy * 2),
        ],
        { mode: 'live' }, // build fast; one commit-normalize at the end
      )
    }
  }
  addWallChain(doc, [vec(0, 0), vec(0.01, 0)]) // trigger one commit pipeline
  const walls = Object.values(doc.walls)
  for (let i = 0; i < 30; i++) {
    addOpening(doc, { kind: i % 2 ? 'door' : 'window', wallId: walls[i * 3]!.id, t: 0.5 })
  }
  for (let i = 0; i < 60; i++) {
    addFurniture(doc, {
      catalogItemId: 'dining-chair',
      x: (i % 10) * 2 + 1,
      y: Math.floor(i / 10) + 0.6,
      size: { w: 0.45, d: 0.52, h: 0.88 },
    })
  }
  return doc
}

describe('performance budgets (loose CI thresholds)', () => {
  it('full derive of a 100+-wall document stays under budget', () => {
    resetDerivedForTests()
    const doc = bigFixture()
    expect(Object.keys(doc.walls).length).toBeGreaterThanOrEqual(100)
    // warm-up (JIT) — the WeakMap makes a second call on the SAME doc free,
    // so measure a fresh derivation via a cloned identity
    getDerived(doc)
    const clone = { ...doc }
    const t0 = performance.now()
    getDerived(clone)
    const ms = performance.now() - t0
    // local ≈ 2-4ms; budget 40ms absorbs cold CI runners
    expect(ms).toBeLessThan(40)
  })

  it('3D mesh-data rebuild of every wall prism stays under budget', () => {
    resetDerivedForTests()
    const doc = bigFixture()
    const derived = getDerived(doc)
    const t0 = performance.now()
    let tris = 0
    for (const solid of Object.values(derived.wallSolids)) {
      for (const prism of solid.prisms) {
        tris += buildPrismMeshData(prism).indices.length / 3
      }
    }
    const ms = performance.now() - t0
    expect(tris).toBeGreaterThan(1000)
    // local ≈ 3-6ms; budget 60ms for CI
    expect(ms).toBeLessThan(60)
  })
})
