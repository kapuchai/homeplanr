# homeplanr — Runbook

Working notes for future development sessions. The full v1 design rationale
lives in the original plan; day-to-day, this file + `src/model/README.md`
(conventions) are what you need.

## State (as of v0.12.0, 2026-07-18)

0.12.0 "Lighting" (NO schema bump — v6 already carried `lumen`/`lightOn`;
`CatalogItem.emitter` is compile-time metadata): **realistic-lighting
master toggle** (`appSettings.realisticLighting`, default OFF until 1.0.0;
OFF renders the pre-0.12.0 scene bit-identically — classic visual
baselines unchanged), **sun model** (`scene3d/sun.ts` pure solar position:
season-preset declination [user chose seasons over dates] + hour angle off
a longitude-derived integer-hour zone, `solarNoon()` exported;
`theme/sunRamp.ts` = EVERY scene channel [sun/hemi/ambient/env/sky-fog]
as one piecewise-linear function of altitude — below −3° the directional
PLAYS THE MOON with a crossfade dip so the 180° bearing flip never pops;
daytime is CONTRAST-TUNED [user feedback]: unshadowed fill (hemi 0.34 /
amb 0.06 / env 0.26) stays well under half the shadowed sun (2.2) so
interiors read darker than outdoors and window shafts carry rooms —
test-pinned; SunSky also sets scene.background and WIDENS the shadow
ortho ≤3× at low sun; hidden dollhouse walls become SHADOW GHOSTS under
realistic [shared colorWrite-less singleton, still casting] so the sun
never floods in from the hidden side; EmitterLight lumens are divided by
LUMEN_SCALE 1/6 [physical candela reads white-hot under ACES —
probe-tuned, change only with night screenshots]), **SunArc scrubber** (top-center 3D overlay; the
curve IS the sun's altitude path over the day, glyph sun/moon; preset
dots sweep timeOfDay via rAF lerp of the value itself riding --dur-2
[reduced-motion → instant]; PanelHandle live-setState/persist-on-release
drag; role=slider with arrows ±15min; hidden while walking),
**location/season settings** (CITY_PRESETS Helsinki-first + lat/long +
northOffset SliderRow + season segmented; ALL lighting state is
device-local appSettings — deliberately not document data),
**light-emitting furniture** (EmitterLight point/spot child of the
instance group — `at` item-local so it scales, mirror negates at[0] in
the RENDERER; lumens → candela [point lm/4π, spot lm/π];
emissiveSlotMaterial keyed cache glows the shade slot;
ShadowBudgetBridge: 2 nearest lit emitters cast @1024 per the M1
WebKitGTK spike [spots ~free, points ×4@1024 → 35fps, ×2@2048 → 19.5fps];
`setFurnitureLight` key-presence mutation, lightOn true DELETES [absent =
ON]; clipboard whitelist +lumen/lightOn at all five sites), **lamps**
(new ceiling-lamp [spot, defaultElevation 2.0 — Furniture3D has no
per-room ceilingZ, documented], wall-sconce [passable — eye-band],
table-lamp [0.75]; floor-lamp gained its emitter; emitter conformance
rule), **panel light rows** (On/Off + Brightness lm, clamp 100–3000;
MultiPanel batched), **night integration** (ceilings cast+receive under
realistic ONLY — the reverse-side shadow pass makes the single-sided
slab cast; ground disc neutral albedo in both UI themes under realistic;
Modal gained max-height scroll — Options outgrew short windows).

0.11.0 "3D Experience" (NO schema bump — additive `previewAssetId`/
`previewCustom` on the v6 doc root): **one-click FPS walk** (the Walk
button enters DIRECTLY — no floor pick, no `arming` state: entry spot =
largest room's centroid [else scene centre] nudged clear via
validateTeleport, and the button's own click gesture calls
`attemptLock` so the cursor vanishes at once — WebKitGTK grants
Pointer Lock ONLY inside a user-activation handler [user-verified];
`pointerLock.ts` keeps a session verdict; capture-drag is the silent
fallback when lock is refused/broken, and floor clicks teleport only in
that fallback; two dead-lock guards — a zero-delta streak AND a
`LOCK_DEADMAN_MS` timer for locks that emit no events — release + mark
the verdict broken; unexpected unlocks disambiguated by
`document.hasFocus()`: Esc-under-lock exits walk, alt-tab keeps walking
on drag), **3D-view settings** (`appSettings`: collisionEnabled,
wallHideMode off/hide, ceilingsEnabled — look mode/sensitivity settings
were CUT on user feedback, lock is the one look path; OptionsDialog
"3D view" `<section>` with the extracted `OnOffRow`; collision OFF
bypasses BOTH `resolveMove` [WalkControls] and `validateTeleport`
[PlannerCanvas]), **dollhouse wall hiding**
(`wallOcclusion.ts` `hiddenWallIds` side-test vs the sceneBBox anchor with
dead-zones; `OccluderBridge` recomputes on throttled OrbitControls change +
`invalidate()`; `visible=false` on per-wall group + its OpeningFixtures +
junction patch [patch hides only when EVERY incident wall hides]; default
ON, off while walking), **per-room ceilings** (`buildCeilingMeshData` =
floor triangulation lifted to the room's LOWEST wall height, SINGLE-SIDED
down-facing so backface culling clears top/high-orbit views with no
occluder logic; `castShadow=false` keeps interiors as bright as today —
hemi/ambient/IBL are unshadowed, only the directional sun would darken;
default ON), **z-fighting fixes** (`realize.ts` `SEAM_EPS` 0.5 mm/side part
inset keeping authored center, dims ≤5 mm exempt; WindowFixture + balcony
DoorFixture frame strips BUTT instead of overlap), **save-preview image**
(`scenePreview.ts` offscreen top-down 512² JPEG from the live builders
minus ceilings/fixtures, transient renderer + failure latch;
`buildFileJson` embeds into a write-time CLONE at all three write sites
unless `previewCustom`; `referencedAssetIds` counts `previewAssetId` so GC
keeps it; recents `thumb` ~128² JPEG in the File menu; custom override =
`setPreviewImage` undoable mutation in the empty-selection PropertiesPanel).
ExportDialog preview deliberately dropped (2D-export dialog).

0.10.0 "Openings" (NO schema bump — rides v6's `Opening.style`):
**opening style registry** (`catalog/openingStyles.ts` — 6 door + 4
window styles, `openingStyleSpec(kind, id)` non-null fallback to standard
is the ONLY lookup path; absent style IS standard, restyle-to-standard
DELETES the field; `defaults` seed dims at placement only, `restyleSill`
the one restyle-forced field), **2D ink prims** (`OpeningSymbol.ink` =
role-tagged lines/arcs from `openingInk`; TWO styling twins:
`OpeningInkGlyph` [editor/ghost/style cards] + exportPlanSvg's emitter;
doorGlyph stays the only arc source — double doors COMPOSE two
half-width calls, sweeps never re-derived), **mode-aware catalog panel**
(place-opening tool swaps the furniture grid for style cards drawn
through the REAL glyph pipeline; per-kind armed memory in
toolParams.doorStyle/windowStyle), **3D per-style fixtures**
(WindowFixture/DoorFixture in PlannerCanvas; ajar leaf φ =
dirSign·swingSign·AJAR mirrors the pinned doorGlyph — verified vs 2D
arcs; arched = elliptical torus + wall-toned spandrel INSIDE the
rectangular carve; leaves are VISUAL ONLY, collision never sees fixture
meshes), **flush-snap** (`fitIntoGaps` snapRadius onto gap edges at the
legal 1cm margin; `findOpeningSlot` gained {exclude, snapRadius}; drag +
ghost snap, Ctrl suspends; demoted pass never snaps), **wall-to-wall
drag** (`rehomeOpening` + selectTool nearest-other-wall capture with 2px
hysteresis, slot-gated; curtains follow via write-through), **clipboard
carries op.style** (payload whitelist extended). Also fixed: 0.9.0's
lint:colors CI regression (raw hex in artTexture → palette
TEXTURE_BASE_WHITE).

0.9.0 recap (schema v5 → **v6**): **embedded image
assets** (`doc.assets` top-level map so undo shares it structurally;
ingest = the ONLY pixel entry — downscale ≤1024, JPEG/WebP-checked/PNG,
≤400KB ladder in `imageIngest.ts`; gcAssets prunes orphans from FILE
BYTES only at the three write sites — the store keeps them for undo;
recovery blob retries once with assets stripped on QuotaExceeded;
clipboard carries asset CONTENT, paste re-ingests content-deduped;
`referencedAssetIds` is THE GC oracle — 0.11.0's preview slot must extend
it), **wall art** (decor category; `CatalogItem.imageSlot` = one flat box
part, conformance-pinned; refcounted per-asset texture materials in
`artTexture.ts` — the only disposed material path; cover-crop via texture
repeat/offset), **curtains/blinds/mirrors** (`passable` items skipped by
walk collision entirely), **window attachment** (`attachedOpeningId`:
pipeline WRITE-THROUGH — reconcileAttachedFurniture syncs stored
x/y/rot/width in both modes, side derived from stored-center perp sign,
manual x/y/rot/width edits DETACH, opening deletion detaches in the same
mutation; placement/drag capture within WINDOW_PICK_PX), **counter
family** (`family` tag + `familyEdge` snap kind, priority 3.5, end-kiss +
back-flush + rotation adoption; square footprints offer both arms),
**per-instance coloring** (furnitureSlotMaterial resolve chain + keyed
(default|hex) cache; hex keeps the base spec's roughness/metalness),
**price/notes/cost** (setFurnitureMeta key-presence semantics; selection
sums + plan-stats Project cost line; `currency` device pref +
deterministic formatCurrency), **ranked search** (KEYWORDS table keyed by
item id + completeness/hygiene tests — every item MUST have an entry).
The v6 bump batched 0.10.0's `Opening.style` and 0.12.0's
`lumen`/`lightOn` (schema-only, lenient).

0.8.0 recap (schema v4 → **v5**): **room rig** (rooms move/
rotate as rigid units — `roomRig.ts` collect/tear/transform; click-then-
drag gesture armed only when the room was ALREADY the sole selection;
tear = raw doc edits inside the gesture tx, neighbor keeps a shared wall
AND its openings [user-confirmed], stored-fingerprint swap keeps identity
+ live rendering; commit demotes rig ids so stationary geometry wins all
welds), **room snapping** (frozen-offset corner-onto-node candidates are
THE weld mechanism + centerline guideX/Y for collinear docking; node
SnapCandidate grew `display`), **room rotation** (roomPivot = centroid
with labelAnchor fallback shared by handle AND math; 15° delta detents
with 6° capture on 90° multiples, Ctrl free — Ctrl NOT Shift, flagged
override of the release file; rotateRoom command behind R/menu),
**per-side finishes** (`finishFront/finishBack` open-registry strings,
MIGRATIONS[4] splits the old both-faces field — first field-splitting
migration; v4 goldens minted pre-bump; makeGoldens gained a
BUILDER_VERSION guard), **WALL_FINISHES registry** (+wallpaperStripe/
wallpaperDamask/panel/plaster; finishSpec(id)→spec|null is the ONLY path
to pattern/roughness — unknown ids render as plain paint, never crash),
**floor registry 17 materials** (+herringbone/plaster PatternKinds,
FloorSpec.group + grouped details/summary picker), **room types UI**
(ROOM_TYPES registry with suggestedFloorId — seeded ONLY when
floorMaterialId absent; type badge via planGeometry.roomLabelLines shared
by BOTH label twins; plan statistics in the empty-selection panel).

0.7.0 recap (schema v3 → v4): **per-part symbol
footprints** (the bbox body mask is gone — silhouette+body prim pairs per
unique part footprint, flattened-opacity group, two styling twins:
SymbolRenderer + exportPlanSvg primEl), **dimension ladder**
(`dimensionLevel`: off/walls/openings/all replaces the showDimensions
boolean; Shift+D cycles; legacy envelopes map true→'walls'), **annotations
visibility toggle** (`showAnnotations`, Shift+A — parity-gated in hitTest
click/marquee AND selectAll; creating an annotation re-enables), **area
tool** ('A', kind:'area' annotations — trace in tool state, ONE addArea on
close), **interface scale** (`uiScale` 0.9–1.5 → --ui-scale CSS token +
scaled pill/room-label chrome; exports pinned at 1×). Schema v4 batched
the settled 0.8.0/0.9.0 fields: Room.roomType?,
FurnitureInstance.price?/notes?/materialOverrides? (schema-only, no UI;
clipboard/duplicate whitelists carry them).

0.6.0 recap (no schema change): **AUR + Flatpak packaging** shipped and
verified locally (`packaging/aur/` with homeplanr-bin PKGBUILD;
`packaging/flatpak/` with com.kapuchai.homeplanr manifest + AppStream
metainfo — see "Distribution channels"; AUR publish + Flathub submission
live in the ROADMAP deferred queue), **new blueprint app icon**
(two-variant SVG sources at src-tauri/icons/src/, regen via
`scripts/makeIcons.sh`, bundle.icon gained 256/512), **filled-cog gear
icon** + toolbar right cluster reordered to [2D 3D] | ? | gear.
**Locale/Russian translation DROPPED from the roadmap entirely** (user
decision 2026-07-16) — the i18n seam stays as chrome-string hygiene; new
chrome strings still go through en.ts/t().

0.5.0 recap (no schema change): the **agent testing rig** (Tier 0:
e2e/helpers.ts + visual baselines; Tier 1: `npm run smoke:native` — see
the rig section), all nine reported bugs fixed (B1 panel commit
misdirection, B2 trackpad wheel modes — native input still deferred, B3
nudge y-inversion, B4 duplicate pills, B5 label sides, B6 PDF fit +
embedded Noto Sans subset with Cyrillic, B7 dialog default dirs, B8 wide
shortcut modal, B9 dark-mode contrast floors test-pinned), split tool
groups, motion tokens. Rename decision: keeping "homeplanr".

0.4.0 recap (no schema change): paste determinism (demoted-set pipeline),
3D camera presets + orbit hint + walk furniture collision (body + eye
bands), catalog hygiene (derived symbols everywhere), pre-click door
swing preview (shared doorGlyph), panel drag-resize/collapse, export
dialog (PNG/SVG/PDF, scale presets, true-vector PDF + overflow prompt),
two bundled templates, the i18n seam (all chrome through t()).

0.3.0 recap: schema v3 (annotations; snapEnabled → device pref), marquee
multi-select, context menu + batch editing + Split wall, copy-paste +
Duplicate room, align/distribute, corner-resize handles, opt-in autosave
(serialized write chain), '?' shortcut sheet, catalog search, UI tokens +
WCAG accent contrast (test-pinned) + focus-trapped modals + ARIA,
transaction ownership tokens, eleven 0.2.0-era bug fixes.

0.2.0 baseline: 2D editor (walls/doors/windows/furniture, snapping, undo),
3D view, 35-item procedural catalog with iso thumbnails, native `.homeplanr`
persistence with crash recovery + silent forward migrations, theming (dark
mode, 6 accents), units (m/cm/ft-in), measure/dimension tools, per-side wall
paint + finishes, 11 floors, first-person walk with collision, plan PNG/SVG
export + 3D screenshot, file association + single instance, Linux
(.deb/.rpm/AppImage) + Windows (NSIS) packaging via CI.

## Commands

| Task | Command |
|---|---|
| Dev (native window, HMR) | `npm run tauri dev` |
| Dev (browser only) | `npm run dev` |
| Unit tests (879) | `npm test` |
| E2E smoke | `npx playwright test --project=chromium` (webkit only works in CI — Arch lacks its Ubuntu-named host libs) |
| Visual baselines (local rig) | `npx playwright test --project=chromium e2e/visual.spec.ts` — add `--update-snapshots` to rebaseline, then EYEBALL the new PNGs |
| Native smoke (Tier 1) | `npm run smoke:native` — needs a FRESH release binary (`npm run tauri build -- --no-bundle`), `~/.cargo/bin/tauri-driver`, and no running homeplanr instance |
| Typecheck / lint | `npm run typecheck` / `npm run lint` |
| Color-token lint | `npm run lint:colors` (raw colors outside the allowed dirs fail CI) |
| Goldens (pre-schema-bump ONLY) | `npx vite-node scripts/makeGoldens.ts` — refuses to overwrite |
| Templates (regen at every schema bump) | `npx vite-node scripts/makeTemplates.ts` — MAY overwrite (bytes churn, content matters) |
| Local bundles | `npm run tauri build` (deb/rpm); AppImage on this Arch box needs `APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1 npm run tauri build -- --bundles appimage` (no fuse2 installed) |
| Run local AppImage | `./src-tauri/target/release/bundle/appimage/*.AppImage --appimage-extract-and-run` |
| Release | push a `v*` tag → `release.yml` builds both OSes + drafts the GitHub release; dry-run anytime via `gh workflow run release.yml` |
| AUR package (local) | `packaging/aur/` — PKGBUILD + README with local-verify + publish runbook (publishing deferred; needs user's AUR account) |
| Flatpak (local) | `packaging/flatpak/` — manifest + README (local build via org.flatpak.Builder, per-user, no sudo) |

## Non-negotiable invariants (tests pin all of these)

- **Meters, plan space x-right/y-down in DATA; the 2D view RENDERS y-up**
  (negative y scale in `viewportMath`/`useViewportTransform`) — this is what
  makes 2D and 3D agree; a y-down render is chirality-flipped vs any 3D
  camera. Never "simplify" the render transform back.
- **One 3D mapping point**: `<group rotation-x={-π/2}>` in PlannerCanvas.
- **Winding**: `triangulate.ts` normalizes ring orientation; prism caps face
  +z/−z by construction; orientation tests compute normals FROM winding.
- **Derived geometry reference stability** (`store/derived.ts`): renderers
  key memos on derived entry OBJECTS. When adding mutations, never write a
  field that hasn't changed (immer identity churn breaks stability — see
  `revalidateOpenings`'s `assign` guard, `reconcileRooms`'s in-place update).
- **One undo entry per gesture**: drags run live-mode mutations inside
  beginTx/commitTx; pointer-up re-runs the final mutation in commit mode
  (this is what runs normalizeGraph/reconcileRooms). `transactions.ts` is
  the only module allowed to touch the zundo temporal API.
- **Openings clamp through ONE oracle** (`findOpeningSlot` / `wallCore`);
  new openings never evict existing ones.
- **updatedAt** is stamped by `serializeDocument` only — mutations never
  touch it.
- The catalog **conformance suite** is the authoring oracle: every new item
  must pass dims/footprint/height/material checks. 2D symbols are DERIVED
  from `build3d` parts (`symbolFromParts.ts`) — do not hand-author symbols.
- **Wall-local frame sign**: `+v` ≡ `+perp(a→b)` ≡ the door-swing 'front'
  side (`paintFront`). `wallSolids.test.ts` (junction/T-junction tiling) and
  `prismGeometry.test.ts` (front/back face buckets) pin it — never re-derive
  the sign from a cross product (that reflection was the v0.1 mirror bug).
- **Collision passability oracle = doors only** (`scene3d/walk/collision.ts`):
  blocking rects are the wall's outline u-span minus door intervals; windows
  always block. Never decide passability from eye-height prism slices.
  **Furniture rects are ADDITIVE** (0.4.0) — they never perturb the wall
  spans; an item blocks iff its vertical extent intersects the body band
  (BODY_BAND_LO..HI, 0.3–1.2m) OR the eye band (EYE_HEIGHT ± 0.2m — else
  the camera clips through head-height cabinets). Constants exported +
  test-pinned; `mirrored` never affects the footprint rect. **Catalog
  `passable` items (0.9.0: curtains, blinds) are skipped entirely** —
  fabric yields regardless of bands; unknown catalog ids block normally.
- **Paste demotion** (0.4.0): `pasteSubgraph` passes every minted id as the
  pipeline's `demoted` set — a demoted node/wall never survives a weld/
  dedupe against a kept one (split fragments INHERIT demotion via
  splitWallRaw), and demoted openings are near-exact-fit-or-drop against
  kept ones (never evict, never relocate beyond DEMOTED_FIT_TOLERANCE).
  An empty set is bit-identical to pre-0.4.0 behavior — never demote on
  non-paste paths.
- **One furniture symbol transform** (`planGeometry.furnitureTransform`)
  shared by WorldLayers, exportPlanSvg, and the InteractionOverlay ghost;
  **one door glyph** (`planGeometry.doorGlyph`, parameterized (u,v)→world)
  shared by placed doors and the pre-click ghost — the empirically-pinned
  arc sweep flags must never fork per consumer.
- **Chrome strings live in `src/i18n/en.ts`** and render via `t()` — new
  raw literals in chrome components are a review flag. File-format
  sentinels ('Untitled') and catalog/material names stay OUT of the table
  (compared/content, not chrome).
- **Keymap 3D matrix**: in the 3D view only the file accelerators
  (Ctrl+N/O/S/Shift+S) stay live — every editing/navigation key is 2D-only,
  and walk mode owns its keys inside WalkControls.
- **Thumbnail pipeline disposes after warmup**: one shared offscreen
  renderer, dropped after the last warmup item (cached data-URLs outlive
  it) — never a second persistent GL context.
- **MAX_SUBSTEP < PLAYER_RADIUS** (anti-tunnel invariant, asserted in a
  collision test) — keep it true when tuning either constant.
- **Components carry no raw colors** — theme tokens only; `npm run
  lint:colors` gates it (raw colors legal only in src/theme, src/catalog,
  tests, and proceduralTextures.ts).
- **Migrations are silent**: a schema-version upgrade never pushes warnings
  and never marks the doc dirty — old files open clean and upgrade only on
  the next explicit save.
- **Transaction OWNERSHIP (0.3.0)**: `beginTx` returns a token;
  `commitTx/abortTx(token)` act only for the owner (a stale nudge timer or
  an outgoing tool can never close a later gesture's tx). The arrow-nudge
  tx opens with `preempt:'commit'` — preemption COMMITS it. Only the keymap
  Esc safety net force-closes token-less. `flushPendingNudge()` runs at
  every non-arrow key AND every pointer entry point.
- **Annotations (v3/v4)**: free world-anchored, NEVER graph-healed (outside
  the self-heal hash), dimension text derived at render (`dist(a,b)` +
  units — never stored; area text likewise from the shoelace of points),
  label `rotate(+θ)` = the furniture sign convention, world-sized labels,
  visibility-parity culling (what AnnotationsLayer hides at a zoom is not
  hittable/marquee-selectable — constants shared via hitTest). The 0.7.0
  `showAnnotations` toggle extends the SAME parity rule: hidden ⇒ not
  hittable (HitOptions.annotationsVisible at every hit call site), not in
  selectAll, pruned from selection on hide; creating an annotation while
  hidden re-enables visibility (a persist must never look like a no-op).
  Area drags are RIGID translates (a drag must never change the readout);
  the trace lives in tool state and lands as ONE addArea on close.
- **Symbol footprint layer (0.7.0)**: per unique part footprint the symbol
  emits a 'silhouette' stroke + 'body' fill pair, rendered inside ONE
  opacity-0.92 group with hairlines on top — fills cover interior stroke
  segments, so the strong border survives only on the part-union boundary.
  TWO styling twins must stay in agreement: SymbolRenderer.buildStyles and
  exportPlanSvg.primEl (silhouette = 2× the outline width in both). Hit
  test/selection/collision stay OBB-based — never symbol-derived.
- **--ui-scale (0.7.0)**: chrome typography + the counter-scaled canvas
  chrome (pills, room labels) multiply by `appSettings.uiScale`; the
  clearance math must receive the SAME scale as the Pill renderer
  (pillMetrics `scale` param) or side labels land on their walls.
  World-sized text (label annotations, meters) and EXPORT paper metrics
  never scale — the default-1 params are load-bearing. Never couple
  --ui-scale to the viewport zoom k or native webview zoom.
- **Room rig (0.8.0)**: `tearRoomRig` is RAW doc edits with NO pipeline
  call (a normalize at zero delta would weld the coincident duplicates
  straight back) and runs INSIDE the gesture tx (abort restores it,
  including the stored-fingerprint swap). Tear predicate = mutual OUTER
  boundary only (a wall in the dragged room's wallCycle AND another
  non-nested room's wallCycle); container/island relations NEVER tear —
  islands ride with walls, furniture, and identities. The torn original
  keeps its openings (the neighbor keeps the door — user-confirmed);
  rig furniture = center inside the OUTER polygon, holes NOT excluded.
  `transformRigRigid` transforms from FROZEN starts (never incremental),
  commit demotes every rig id (paste semantics — stationary wins), and
  the sub-MERGE_EPS guard commits a whole-room micro-drag as an exact
  no-op (else shared corners weld back and the room lands SHEARED). The
  gesture aborts (never commits) a zero-delta drop — no empty undo entry.
  Room drag arms ONLY when the room was already the sole selection at
  pointer-down, captured BEFORE the down-time selection update — the
  marquee-from-room-floor gesture is load-bearing and test-pinned.
- **Room rotation pivot** = `roomPivot` (centroid; labelAnchor when the
  centroid is outside — L-shapes), shared by the handle AND the rotation
  math — anchoring them differently makes the handle orbit the pivot.
  Corner-node coincidence is THE weld mechanism for room snapping
  (normalizeGraph has no collinear-overlap merge); guides only make
  collinear docking exact (T-split + demoted dedupe = shared segment).
- **Finish/floor/roomType lookups go through their spec fallbacks**
  (`finishSpec`/`floorSpec`/`roomTypeSpec`) — open registries mean
  unknown ids ARRIVE from forward-compatible files; indexing a pattern
  or name table directly with an unknown id crashed the 3D scene once.
  'paint' is the reserved absent-default finish id — never register it.
- **Room label twins**: `planGeometry.roomLabelLines` is the ONE source
  for title + type line in WorldLayers AND exportPlanSvg (name, else
  known type name, else 'Room'; the type line never duplicates the name).
- **setRoomType floor suggestion** seeds ONLY when floorMaterialId is
  absent — a user's floor choice is never overwritten; clearing the type
  never touches the floor.
- **Images enter documents ONLY through `imageIngest.ingestImage`**
  (decode → downscale ≤1024 → re-encode with a CHECKED result mime →
  ≤400KB ladder). `doc.assets` is GC'd from FILE BYTES only, never the
  store (undo can resurrect referencers); `referencedAssetIds` is the
  single reference oracle — new reference kinds (0.11.0 preview) extend
  it or GC eats their assets. Assets stay OUT of the self-heal hash.
- **Attached furniture (0.9.0 curtains) is pipeline WRITE-THROUGH**
  (`reconcileAttachedFurniture`, both modes, after revalidateOpenings):
  every consumer reads plain stored x/y/rotation/size.w — never introduce
  a parallel derived transform. Manual x/y/rotation/width edits DETACH
  (else the next sync reads as a swallowed edit); elevation/mirror/d/h
  keep it. Wall side = stored-center perp sign, no schema field.
- **Every catalog item has a KEYWORDS entry** (`catalog/search.ts`) —
  the completeness test fails the build for a missing or stale id, and
  the hygiene test rejects name-redundant keywords.
- **Opening styles (0.10.0) resolve ONLY through `openingStyleSpec`**
  (open registry; unknown/absent → the kind's standard spec, never null).
  Absent style IS standard: mutations never persist 'standard' and
  restyling back to it deletes the field. `op.width` means REVEAL WIDTH
  for every style — attachment, hit test, dimensions, and collision all
  depend on it; a style must never reinterpret it.
- **Opening ink twins (0.10.0)**: `openingInk` builds role-tagged prims
  (jamb/leaf/glazing/track/passage + swing arcs); `OpeningInkGlyph`
  (editor layer, ghost, style cards) and exportPlanSvg's ink emitter are
  the TWO styling twins that must stay in agreement. doorGlyph remains
  the only swing-arc source — double doors compose two half-width calls;
  never re-derive sweeps per style.
- **3D door leaves are VISUAL ONLY** (`DoorFixture`): the ajar rotation
  φ = dirSign·swingSign·AJAR mirrors doorGlyph's pinned semantics (at
  90° it reduces to leafEnd algebraically). Collision reads realized
  intervals and never sees fixture meshes — an ajar leaf must never
  enter the collision set.
- **Flush-snap margin stays law** (`fitIntoGaps` snapRadius): snapping
  lands at gap edges = neighbor + openingCoreMargin (1 cm), never
  closer; zero radius is bit-identical to pre-0.10.0 and the demoted
  paste pass never snaps. `findOpeningSlot`'s `exclude` exists so a
  dragged opening ignores itself — never pass it on placement paths.
- **File writes serialize** through `serializedWrite` (controller.ts) —
  explicit saves AND autosaves; every input is (re)read INSIDE the lock.
  Doc-replacing ops serialize through `serialized()` and cancel pending
  autosaves after their guard resolves.
- **Confirm prompts QUEUE (FIFO)** and each declares a non-destructive
  `escValue` (the recovery prompt's Esc means dismiss-keep-blob, never
  Discard). The shared `Modal` owns Esc/focus-trap/restore.
- **Pointer Lock is requested INSIDE the gesture (0.11.0)**: WebKitGTK
  grants `requestPointerLock` only from a user-activation handler — the
  WALK BUTTON's click calls it (walk enters directly, no floor pick;
  the old `arming` state is gone); WalkControls' walking-effect attempt
  and the fallback-teleport click are lenient-engine retries, NOT the
  primary path. Capture-drag stays armed regardless so a refused/absent
  lock costs nothing (drag is the e2e-testable path — Playwright can't
  drive lock). A lock that ENGAGES with dead plumbing is caught two
  ways — a zero-delta streak AND a deadman timer (no events at all) —
  both release + latch the session verdict `broken`. Unexpected unlocks
  disambiguate on `document.hasFocus()`: focused ⇒ Esc ⇒ exit walk;
  unfocused ⇒ alt-tab ⇒ keep walking on drag. `walkStore.locked` gates
  floor-click teleports (no cursor under lock).
- **Collision toggle bypasses BOTH oracles (0.11.0)**: `collisionEnabled`
  off short-circuits free-walk `resolveMove` (WalkControls, `plan += d`)
  AND floor-click `validateTeleport` (PlannerCanvas, raw plan to
  `requestWalkTo`). Patching only one still blocks the other. Constants
  (PLAYER_RADIUS, MAX_SUBSTEP anti-tunnel) untouched — the toggle is a
  short-circuit, never a retune.
- **Wall occlusion is a pure side-test (0.11.0)** (`wallOcclusion.ts`):
  a wall hides iff camera and the sceneBBox anchor are on clearly
  opposite sides of its infinite line (dead-zones keep the top view and
  partitions-through-the-anchor visible). `visible=false` (never a
  material clone — hide mode needs none) on the per-wall group, its
  OpeningFixtures, AND the junction patch (a pillar hides ONLY when every
  incident wall hides, else a visible wall loses its end cap). Recompute
  is throttled on OrbitControls `change` + `invalidate()` (demand
  frameloop). OFF while walking. patchHidden reads `doc.walls` incidence
  but the hidden set is `wallSolids`-domain — safe because normalizeGraph
  welds away any wall too short to reach a `wallSolids` entry.
- **Ceilings are single-sided, down-facing, non-casting (0.11.0)**
  (`buildCeilingMeshData`, `CeilingMesh`): the room's floor triangulation
  (holes applied) lifted to the room's LOWEST wall height, winding
  reversed so the −z normal is the visible face — backface culling clears
  top/high-orbit views with NO occluder pass. `castShadow=false` is
  load-bearing: hemi/ambient/IBL are unshadowed in three.js, so only the
  directional sun could darken a covered room; an uncasting ceiling keeps
  interiors exactly as bright as pre-0.11.0 (revisit when 0.12.0 adds
  interior lights). Gated on `ceilingsEnabled`.
- **Furniture seam inset is render-only (0.11.0)** (`realize.ts`
  `SEAM_EPS` 0.5 mm/side): every part is built smaller around its
  AUTHORED center (translate math uses the original size so centers never
  drift), dims ≤ `MIN_SHRINKABLE` (5 mm) exempt so thin panels can't
  invert. Symbols, footprints, and collision derive from item DEFS, never
  realized geometry — the inset never reaches them. Window/door frame
  strips BUTT (start above the bottom rail, stop under the top rail / arch
  spring) instead of overlapping — no two frame boxes share a coplanar
  face.
- **Save preview rides the assets map, never blocks a save (0.11.0)**:
  doc-level `previewAssetId`/`previewCustom` are ADDITIVE on v6 (no bump);
  `referencedAssetIds` counts `previewAssetId` (THE GC oracle — else
  gcAssets eats it), the validator keeps dangling ids like furniture art,
  both stay OUT of the self-heal hash. `buildFileJson` (all three write
  sites — save/save-as/autosave write identical bytes) renders a fresh
  top-down JPEG into a write-time CLONE unless `previewCustom` — the store
  doc is NEVER mutated (no dirty state, no undo entry; content-dedup keeps
  ids stable), and ANY failure (latched GL, empty scene, encoder) falls
  through to plain bytes. `scenePreview.ts` uses a TRANSIENT renderer
  (create→render→dispose per call — the one-persistent-context invariant
  holds) with a session failure latch. The custom override
  (`setPreviewImage`) IS an undoable, dirtying mutation — the deliberate
  asymmetry vs the write-time auto embed.

- **Realistic lighting is a RENDER-PATH SWITCH, never a retune (0.12.0)**:
  toggle OFF must render the pre-0.12.0 scene bit-identically — the
  classic SceneEnvironment branch stays untouched, exposure forced 1,
  ceiling shadow flags off, theme ground tint restored, scene.background
  null. The classic visual baselines pin it; touch the classic branch
  only with a rebaseline in hand.
- **Sun/ramp purity (0.12.0)**: solar position is a pure function of
  (lat, lon, season, hours) and every lighting channel a pure function of
  altitude (`sunRamp` stops) — no clocks, no state reads. Scrubbing
  timeOfDay IS the animation system; anything time-driven must flow
  through these two functions. The daytime CONTRAST CONTRACT is
  test-pinned: unshadowed fill (hemi+ambient+env) < sun/2, so occlusion
  visibly matters indoors — never rebalance the stops back toward flat
  fill without night/noon screenshots in hand.
- **Hidden walls cast under realistic lighting (0.12.0)**: the occluder's
  hidden set renders as shadow GHOSTS (ONE shared colorWrite/depthWrite-
  false singleton — the no-per-wall-clones rule holds; ghosts are
  invisible, non-occluding, castShadow only, and r3f events ignore
  handler-less meshes so floor-click teleports still pass). Classic mode
  keeps plain visible=false. OpeningFixtures stay fully hidden either way.
- **Interior shadow budget (0.12.0, M1 spike-pinned)**: emitter lights
  always render (shadowless is free on WebKitGTK); only the ≤2 nearest
  lit emitters cast, at 1024² — interior maps NEVER 2048 and never more
  than 2 casters (point-light cube maps are the cliff: ×4@1024 35fps,
  ×2@2048 19.5fps). The sun keeps its separate 2048 directional map.
- **Emitters are catalog metadata (0.12.0)**: `CatalogItem.emitter` never
  persists; `at` is item-local and the RENDERER negates x when mirrored
  (realizeItem mirrors geometry only). `lightOn` ABSENT means ON —
  setFurnitureLight deletes `true` and stores only `false`; absent lumen
  = the emitter's defaultLumen. The clipboard whitelist carries
  lumen/lightOn (five sites — forgetting one silently strips on paste).
- **IBL intensity ownership is SPLIT (0.12.0)**: the PMREM texture effect
  never writes environmentIntensity; the classic 0.45 lives in its own
  [realistic]-keyed effect and SunSky owns the value under realistic —
  React runs child effects before parent effects, so an unconditional
  parent-side write clobbers the ramp (the night-rendered-as-day bug).

## Schema change checklist (bumping schema N → N+1)

1. Run `npx vite-node scripts/makeGoldens.ts` and commit the OUTGOING-version
   goldens BEFORE bumping — the script names files by the current
   `SCHEMA_VERSION` and refuses to overwrite (goldens are byte-frozen).
2. Bump `SCHEMA_VERSION` and the `ProjectDocument.schemaVersion` literal in
   `src/model/types.ts`.
3. Write `MIGRATIONS[N]` in `src/store/persistence/serialize.ts` — pure
   (never mutate the input), total (never throw on junk; the whitelist
   prunes after), and NO warnings pushed.
4. Extend the validator whitelist for the new fields — value-validate with
   silent normalization (invalid → field absent, no warning); for open
   registries (paint ids, floor material ids) accept any non-empty string
   and rely on the render-side fallback, so patch-release additions stay
   forward-compatible.
5. Tests (`src/store/persistence/migrations.test.ts`): EVERY historical
   golden opens with healed=false and zero warnings; forward-refusal at
   N+1; a vN recovery blob decodes; new-field roundtrip + invalid-value
   normalization.
6. Regenerate the bundled templates at the NEW version
   (`npx vite-node scripts/makeTemplates.ts` — overwrites freely) so they
   keep parsing with healed=false; `templates.test.ts` pins it.
7. Invariant: migrations are silent — old files open clean and upgrade on
   the next explicit save.

## Verification gates (used at every milestone; keep using them)

1. `npm test` + typecheck + lint + build — all zero-noise.
2. Chromium e2e locally; webkit e2e rides CI.
3. `npm run tauri dev` manual pass for anything interaction-heavy.
4. Packaged AppImage pass before tagging (dev and package have SEPARATE
   localStorage — recovery/recents don't carry over).
5. CI green before considering a push done (`gh run watch`).
6. Dark-mode visual pass — 2D and 3D — after any theme-touching change.
7. Walk-mode look on WebKitGTK in `npm run tauri dev` (0.11.0): ONE
   click on Walk hides the cursor and enters first-person — the mouse
   turns the head directly (Pointer Lock, requested inside the button's
   own click); Esc exits and restores the cursor; alt-tab keeps you
   walking. The invisible fallback (lock refused/broken): drag-to-look
   with a visible cursor — no text selection, no dropped drags.
8. Packaged file-association double-click: cold start AND second-instance
   relay into the already-running window.
9. Catalog thumbnails render; then force a context loss (devtools
   `WEBGL_lose_context`) and confirm cards fall back to SVG symbols.
10. PNG and SVG exports open in an external viewer.
11. Visual baselines green (`e2e/visual.spec.ts`); after INTENTIONAL visual
    changes rebaseline with `--update-snapshots` and eyeball every changed
    PNG before committing.
12. Native smoke green (`npm run smoke:native`) against a FRESH release
    binary — verifies argv file-open, IPC title, plan render, no GL
    banner, real WebKitGTK screenshot.

## Agent testing rig (0.5.0 — how the agent sees the app)

Tier 0: Playwright chromium against the browser build (`npm run dev` is
auto-started by the Playwright webServer). The loop for UI-visible work:

1. **Ad-hoc probe**: throwaway spec (scratchpad or `e2e/`) importing
   `e2e/helpers.ts` — `drawRoom` (opts.exact holds Ctrl to suspend
   snapping), `placeFurniture`, `canvasPoint`, `show3d`/`show2d`,
   `cameraPreset`, `openOptions`/`openExport`, `newFromTemplate`,
   `seedAppSettings`, `dismissRecovery`. Run
   `npx playwright test --project=chromium <spec>`, screenshot, Read the
   PNG. Promote worthwhile probes to real specs.
2. **Visual baselines** (`e2e/visual.spec.ts` → `e2e/__screenshots__/`):
   2D Studio-template plan (± dimensions, ± dark), toolbar (± dark), 3D
   iso, Options/Export dialogs, shortcut sheet. Chromium-only and SKIPPED
   ON CI — font rasterization is per-box; this is the local rig, CI keeps
   the functional suite.
3. **Dark-mode probes**: `seedAppSettings(context, { theme: 'dark' })`
   BEFORE `goto` (data-theme stamps pre-first-paint), or drive the
   Options UI like options.spec.
4. Browser-mode caveats: no native dialogs/fs (browser adapter downloads
   via Blob — interceptable with `page.waitForEvent('download')`), no
   WebKitGTK quirks, no Tauri IPC. Fresh contexts have empty localStorage;
   an edit + reload triggers the recovery prompt (`dismissRecovery`).
5. WebGL specs (walk, the 3D baseline) run isolated under full-suite load
   (see quirks).
6. Pixelmatch tolerates subtle TINT shifts (per-pixel threshold 0.2) — a
   pure color retune can pass against a stale baseline. After intentional
   color-only changes, DELETE the affected PNGs and re-run to force fresh
   baselines (`--update-snapshots` alone won't rewrite a passing shot).

Tier 1 — native smoke (`npm run smoke:native`, scripts/nativeSmoke.mjs):
drives the REAL release binary via `~/.cargo/bin/tauri-driver` →
`/usr/bin/WebKitWebDriver` (W3C WebDriver; compat verified 2026-07-16:
webkitgtk-6.0 driver ↔ webkit2gtk-4.1 app, same upstream 2.52.5). Covers
what Tier 0 can't: real IPC (window title), the argv file-association
cold-start, real WebKitGTK rendering + W3C screenshots (the ONLY
screenshot route on locked-down Wayland). Zero npm deps. Preconditions in
the script header; it exits 2 with instructions when they're missing.
Debug binaries load from the vite devUrl (5173) — the smoke uses the
RELEASE binary so the bundled dist is what's tested. Run it as part of
the release gates, right after the local bundle build.

## Distribution channels (0.6.0 — verified on this Arch box)

- **AUR**: `homeplanr-bin` repacks the released .deb. makepkg picks up
  source files sitting next to the PKGBUILD before downloading — that's the
  local-verify route (draft release assets are NOT downloadable). Deps on
  Arch: `webkit2gtk-4.1 gtk3 hicolor-icon-theme shared-mime-info` (deb
  declares libwebkit2gtk-4.1-0 + libgtk-3-0). hicolor's `256x256@2` dir is
  REAL on Arch (not a tauri bug) — but tauri puts a 256px png there where
  512px is implied; ship a plain 256x256 (+512) in the icon refresh.
- **Flatpak**: app-id `com.kapuchai.homeplanr`, runtime org.gnome.Platform
  //49 (ships libwebkit2gtk-4.1; an ARCH-built deb runs fine against it —
  runtime glibc is new enough). Verified under the sandbox: argv file-open
  via document portal (cold + second-instance relay both work; fs-scope
  `allow_file` accepts `/run/user/*/doc/*` paths), single-instance D-Bus
  name allowed (app-id-prefixed), recents written with parsed doc name,
  **doc-portal grants persist after app exit** (Recents reopen works).
  localStorage/appdata = a THIRD storage root: `~/.var/app/<app-id>/`.
  Flatpak auto-rewrites the exported desktop Exec with `--file-forwarding
  … @@ %F @@` — double-click rides the portal with no manifest work.
  Quirk: org.flatpak.Builder's sandbox can't see host `/tmp` — run local
  builds from a dir under $HOME, and NEVER inside the repo: the build-dir
  rootfs has symlink loops that crash Vite's watcher (ELOOP). Use
  `~/.cache/homeplanr-flatpak/`.
  Keep finish-args minimal (wayland/fallback-x11/ipc/dri, NO --filesystem).
  Flathub submission is post-release; see packaging/flatpak/README.md.

## Platform quirks (hard-won; don't re-learn)

- **WebKitGTK pinch-zoom** happens at the GTK layer: JS gesture events are
  not enough. `zoomHotkeysEnabled: false` in tauri.conf + window-level
  ctrl-wheel preventDefault are the current levers. If pinch still zooms the
  window on some setups, it's a wry/WebKitGTK issue — check wry release notes.
- **`Canvas fallback` in r3f v9 is img-alt content that ALWAYS mounts** —
  never use it as a WebGL-failure signal; the GlErrorBoundary around Canvas
  is the correct catch point (it produced a phantom "WebGL unavailable"
  banner once).
- **Don't request `powerPreference: 'high-performance'`** in the GL config —
  suspected WebKitGTK context-creation failures.
- **GNOME shows a cog icon in dev and for unintegrated AppImages** — the
  icon only appears via installed .desktop entries (.deb/.rpm) or AppImage
  integrators (Gear Lever). Not a bug.
- **linuxdeploy needs FUSE**: on fuse2-less systems export
  `APPIMAGE_EXTRACT_AND_RUN=1` for bundling and use
  `--appimage-extract-and-run` to run AppImages.
- **Playwright WebKit cannot launch on Arch** (Ubuntu-named libs); CI covers it.
- **The pinned tauri-cli emits `Exec=homeplanr` WITHOUT `%F` and ships no
  shared-mime XML** for `bundle.fileAssociations` — Linux double-click would
  silently do nothing. `src-tauri/homeplanr.desktop` (literal template with
  `Exec=homeplanr %F`) + `src-tauri/mime/homeplanr.xml` are wired via
  `bundle.linux.{deb,rpm}.desktopTemplate/files`. If the CLI is ever bumped,
  re-inspect a built .deb (`ar x` + `bsdtar`) before deleting them.
- **CI AppImages bundle Ubuntu 22.04's `libwayland-*` → white window on
  rolling distros** (`Could not create default EGL display: EGL_BAD_PARAMETER`
  in the launch log): host mesa ≥24 can't bring up EGL against 2022
  libwayland, while mesa itself is host-provided. release.yml repacks the
  AppImage without `usr/lib/libwayland-*` (verified fix on CachyOS/AMD
  Wayland). Local `tauri build` AppImages never had the issue (they bundle
  the build host's own libwayland). If bundling ever changes, re-test a CI
  AppImage on a rolling distro before shipping.
- **Door-arc sweep flags are empirically pinned** (two user checks, y-down
  and y-up). Verify visually after any viewport-transform change; don't
  re-derive from theory.
- **The 3D Top camera preset renders the plan rolled 180°** vs the 2D
  view (chirality-preserving — a camera-up convention, not a mirror bug;
  established pre-0.10.0). Account for it when comparing top-view
  screenshots against the 2D plan.
- **single-instance MUST stay the FIRST Rust plugin** registered in lib.rs —
  it decides whether the process runs at all; a second launch relays its
  argv/cwd into the callback and exits before any other plugin or window
  exists.
- **argv `.homeplanr` paths are fs-scope-granted in Rust BEFORE the frontend
  reads them** — cold start in `.setup()` (parked for `take_launch_file`),
  second instance before the `open-file` emit. Move the `allow_file` call
  and double-click opens fail with a scope error.
- **The goldens runner is `npx vite-node`** — node 26 type-stripping can't
  resolve the repo's extensionless TS imports, so plain
  `node scripts/makeGoldens.ts` won't run.
- **App settings share the dev/packaged localStorage split** — theme,
  accent, and units set under `tauri dev` don't carry into a packaged build
  (same storage as recovery/recents; see gate 4).
- pkill sweeps of `vite`/`tauri dev` return exit 143/144 in this harness —
  harmless.
- **walk.spec e2e flakes under FULL-SUITE load** (headless-chromium WebGL
  first frame starves when specs run in parallel) — it passes in isolation
  (`npx playwright test --project=chromium e2e/walk.spec.ts`). Re-run
  isolated before blaming a change.
- **argv multi-file opens are first-wins BY DESIGN** (single-document app;
  lib.rs `find_map` takes the first `.homeplanr`) — wontfix.
- **makeGoldens' `buildFull` is intentionally version-rotted between bumps**
  (it still calls the outgoing version's API and asserts on it, so an
  accidental run at the NEW version throws before writing) — rewrite it to
  freeze the outgoing feature set as step 1 of every schema bump.

## Session workflow that worked

Milestone-sized commits, each: implement → all gates green → user-verified
in the running app → commit with a detailed message → push → `gh run watch`.
User visual checks caught what tests couldn't (mirror chirality, arc sweep,
pinch behavior, selector collisions) — always do the human pass for UX.

## Roadmap (0.5.0 → 1.0.0)

**The user's feature list was collected and planned 2026-07-16 — see
`docs/roadmap/`**: `ROADMAP.md` (release ladder + live status + deferred
queue), `CONTEXT.md` (session protocol — read it at the start of every
release session), one `vX.Y.0.md` per release. The user starts a release
session by typing just the version number.

Absorbed into the ladder from the old 0.5.0 backlog: AUR + Flatpak
packaging → v0.6.0 (gated on the naming decision, `docs/roadmap/naming.md`;
the PKGBUILD/`github-actions-deploy-aur`/`AUR_SSH_PRIVATE_KEY`/
flatpak-builder notes live in `v0.6.0.md`); embedded PDF fonts → v0.5.0
(with the PDF-export fix); runtime locale switch + icon polish → v0.6.0.

Accepted non-fixes (documented, no work planned): PropertiesPanel one-click
edits inside the 300ms nudge window fold into the nudge undo entry
(physically negligible); argv multi-file opens are first-wins.
