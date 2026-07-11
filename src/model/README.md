# homeplanr conventions (the cross-module contract)

Every module in this codebase relies on these. Change nothing here without
updating the orientation-pinning tests in `src/geometry/`.

## Units & coordinate spaces

- **All lengths are meters** (floats), in code and in saved documents.
  The UI formats to cm/m per `settings.unitDisplay`; formatting only.
- **Plan space** is `(x → right, y → down)` — screen-aligned, SVG-native.
  Angles are radians. "Front" of a furniture item is **−y** in item-local
  coordinates (origin at footprint center, z = 0 at floor).
- **3D mapping** happens in exactly ONE place: the r3f scene wraps all
  plan-space content in `<group rotation-x={-Math.PI/2}>`, so plan
  `(x, y, z=height)` → world `(x, z, −y)` and height maps to world +Y.
  Meshes are authored in plan coordinates (x, y plan, z up).

## Winding & normals

Pinned by tests that compute normals **from triangle winding** (never from
the normal attribute): unit-square room has area 1; floor world-normal is +Y;
wall top caps +Y; lintel bottom caps −Y; wall side normals point away from
the wall centerline. `geometry/triangulate.ts` normalizes ring orientation
before earcut (outer ring → positive shoelace, holes → negative).

## IDs

Branded string types, prefixed nanoid(10): `n_` node, `w_` wall, `o_` opening,
`r_` room, `f_` furniture.

## Epsilons (`geometry/constants.ts`)

`EPS = 1e-9` (math) · `GEOM_EPS = 1e-6` m (coincidence) ·
`MERGE_EPS = 0.01` m (node welding / graph normalization) · `MITER_LIMIT = 3`.

## Error surface

Native `message()` dialogs for errors/warnings; passive info goes to the
status-hint line. No toast system in v1.
