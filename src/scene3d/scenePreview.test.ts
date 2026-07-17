import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testLevelDoc } from '../test/fixtureDoc'
import { Mesh } from 'three'
import { buildFixtureLevelDoc } from '../test/fixtureDoc'
import { getDerived } from '../store/derived'
import {
  __setPreviewRendererFactoryForTests,
  buildPreviewScene,
  renderScenePreview,
  PREVIEW_SIZE,
  type PreviewRendererLike,
} from './scenePreview'

const fakeRenderer = () => {
  const calls: Record<string, unknown[][]> = { setSize: [], setClearColor: [], render: [], dispose: [] }
  const r: PreviewRendererLike = {
    setSize: (...a: unknown[]) => void calls.setSize!.push(a),
    setClearColor: (...a: unknown[]) => void calls.setClearColor!.push(a),
    render: (...a: unknown[]) => void calls.render!.push(a),
    dispose: () => void calls.dispose!.push([]),
    domElement: { toDataURL: (type?: string) => `data:${type ?? 'image/png'};base64,FAKE` },
    outputColorSpace: '',
    toneMapping: 0,
  } as PreviewRendererLike
  return { r, calls }
}

beforeEach(() => __setPreviewRendererFactoryForTests(null))

describe('buildPreviewScene', () => {
  it('assembles walls, floors, and furniture from the fixture doc', () => {
    const doc = buildFixtureLevelDoc()
    const { scene, root, dispose } = buildPreviewScene(doc, getDerived(doc))
    expect(root.rotation.x).toBeCloseTo(-Math.PI / 2) // the one mapping
    let meshCount = 0
    root.traverse((o) => {
      if (o instanceof Mesh) meshCount++
    })
    // 2 rooms of floors + walls + patches + 6 furniture items (multi-slot)
    expect(meshCount).toBeGreaterThan(10)
    expect(scene.children.length).toBeGreaterThan(1) // root + lights
    expect(() => dispose()).not.toThrow()
  })
})

describe('renderScenePreview', () => {
  it('renders a JPEG through the injected renderer and disposes it', () => {
    const { r, calls } = fakeRenderer()
    __setPreviewRendererFactoryForTests(() => r)
    const doc = buildFixtureLevelDoc()
    const out = renderScenePreview(doc, getDerived(doc))
    expect(out).not.toBeNull()
    expect(out!.dataUrl.startsWith('data:image/jpeg')).toBe(true)
    expect(out!.w).toBe(PREVIEW_SIZE)
    expect(out!.h).toBe(PREVIEW_SIZE)
    expect(calls.setSize![0]).toEqual([PREVIEW_SIZE, PREVIEW_SIZE, false])
    expect(calls.setClearColor![0]![1]).toBe(1) // OPAQUE — JPEG has no alpha
    expect(calls.render!.length).toBe(1)
    expect(calls.dispose!.length).toBe(1) // transient context released
  })

  it('an empty document yields null without touching the renderer', () => {
    const factory = vi.fn(() => fakeRenderer().r)
    __setPreviewRendererFactoryForTests(factory)
    const doc = testLevelDoc('p_empty', 'Empty')
    expect(renderScenePreview(doc, getDerived(doc))).toBeNull()
    expect(factory).not.toHaveBeenCalled()
  })

  it('latches off after a renderer failure and never throws', () => {
    const factory = vi.fn(() => {
      throw new Error('no GL')
    })
    __setPreviewRendererFactoryForTests(factory)
    const doc = buildFixtureLevelDoc()
    const derived = getDerived(doc)
    expect(renderScenePreview(doc, derived)).toBeNull()
    expect(renderScenePreview(doc, derived)).toBeNull()
    expect(factory).toHaveBeenCalledTimes(1) // latched — no second attempt
  })
})
