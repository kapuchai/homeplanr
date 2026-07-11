import { BufferAttribute, BufferGeometry } from 'three'
import type { MeshData } from './prismGeometry'

/** Wrap pure mesh arrays in a three.js BufferGeometry. */
export function toBufferGeometry(data: MeshData): BufferGeometry {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(data.positions, 3))
  geo.setAttribute('normal', new BufferAttribute(data.normals, 3))
  geo.setAttribute('uv', new BufferAttribute(data.uvs, 2))
  geo.setIndex(new BufferAttribute(data.indices, 1))
  return geo
}
