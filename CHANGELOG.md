# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.0] - 2026-07-17

### Added

- **First-person mouse-look in walk mode** — walk mode now grabs the
  mouse for true FPS look where the platform supports it: the cursor
  vanishes and the mouse turns your head directly, no dragging. Where
  pointer capture isn't available it falls back to the familiar
  drag-to-look, automatically. Press Esc to leave. A *Walk look* setting
  (Auto / Mouse / Drag) and a *Look sensitivity* control live in the new
  3D-view options
- **3D view settings** — a new *3D view* section in Options: walk-look
  mode and sensitivity, a *Walk collision* switch (turn it off to walk
  through walls), *Hide facing walls*, and *Ceilings*
- **See into rooms from outside** — in the orbit view, walls between you
  and the room's interior fade away as you rotate, so you look straight
  into the floor plan like a dollhouse. Toggleable; always off while
  walking (you're inside)
- **Ceilings** — rooms now have a ceiling overhead in walk mode and from
  low angles. Looking down from the top or a high orbit, ceilings step
  out of the way so you still see the plan. Toggleable
- **A picture of every plan** — saving a `.homeplanr` file now tucks a
  small top-down 3D snapshot inside it, shown as a thumbnail next to the
  file in *File → recent*. Prefer your own image? Set a custom preview
  from the empty-selection properties panel (*Preview image → Upload*),
  or switch back to *Auto* any time

### Changed

- 3D furniture no longer shimmers along the seams where parts meet
  (a sub-millimetre inset), and window and door frames no longer flicker
  at their corners (mitred frame joints)

## [0.10.0] - 2026-07-17

### Added

- **Door styles** — doors are no longer one-of-each. Pick a style before
  placing: *Standard*, *Sliding* (barn-style panel gliding along the
  wall), *Double* (two mirrored leaves), *Balcony* (glazed leaf),
  *Passage* (an open doorway with no leaf at all), or *Garage* (a wide
  segmented gate). Each has its own plan symbol and 3D look
- **Window styles** — *Standard*, *Full-height* (glass from the floor),
  *Panorama* (extra-wide with mullions), and *Arched* (a rounded arch in
  3D). Styles pre-fill sensible sizes; every dimension stays editable
- **Doors stand ajar in 3D** — the flat closed slab is gone. Hinged
  doors stand three-quarters open on their actual hinge side and swing
  direction, matching the plan's swing arc exactly; sliding doors stand
  partially slid under their track; garage doors sit closed. Walk mode
  still passes through doorways freely — an open leaf never blocks you
- **Style cards in the side panel** — activating the Door or Window tool
  swaps the furniture catalog for style cards with drawn previews; the
  chosen style stays armed per tool. Restyle an existing opening any
  time from its properties panel — dimensions you set are kept
- **Flush placement** — dragging or placing an opening near a neighbor
  snaps it flush against it, leaving no sliver of wall between; Ctrl
  drops it freely, like every other snap
- **Drag openings between walls** — dragging a door or window near
  another wall moves it there (with its size, hinge, swing, and style;
  attached curtains follow their window). If it doesn't fit, it stays
  put

### Changed

- The pre-click door/window ghost now previews the full styled symbol
  (windows show their glazing lines too)

### Fixed

- A raw color literal introduced in 0.9.0's review fixes slipped past
  the color lint into the 3D art-texture path; main-branch CI has been
  red on it since — now sourced from the palette (no visual change)

## [0.9.0] - 2026-07-17

### Added

- **Wall art with your own images** — three framed pieces (portrait, wide,
  square) in the new *Decor* catalog section. Upload any photo from the
  properties panel: it is downscaled and embedded into the `.homeplanr`
  file itself (plans stay a single portable file) and shown on the frame
  in 3D. Copying art to another plan carries the image along
- **Curtains and blinds** — curtains placed near a window snap onto it,
  size themselves to the window with an overhang, and *follow the window*
  when it moves or its wall is edited; dragging them away (or pressing
  Detach) releases them. In walk mode you pass through fabric — curtains
  over a balcony door don't wall it off
- **Mirrors** — wall and full-length, with a bright metallic finish
- **Modular kitchen counters** — straight runs (30/60/90/120 cm), a
  corner piece, a sink module, and a cooktop module. Same-family pieces
  click together end-to-end with flush backs, so runs assemble seamlessly
- **Recolor any furniture** — a *Colors* section in the properties panel
  recolors each part of an item (fabric, frame, top, …) with a color
  picker; reset returns the stock look. The finish keeps its material
  character (a recolored sofa still reads as fabric)
- **Prices, notes and project cost** — per-item price and notes fields;
  a multi-selection shows the cost of the selected items, and the plan
  statistics block (visible when nothing is selected) shows the whole
  project's cost. Pick your currency symbol (€ $ £ kr or none) in
  Options → Units
- **Smarter catalog search** — results are ranked (name matches first)
  and synonyms work: try "couch", "refrigerator", "wc", "worktop",
  "poster"

### Changed

- Plans save as schema v6 (older files upgrade automatically on save);
  the format now carries embedded images with garbage collection of
  unused ones on save, and crash recovery survives quota pressure by
  dropping only the images, never the plan

## [0.8.0] - 2026-07-17

### Added

- **Move rooms as a whole** — select a room (click its floor), then drag:
  the room moves with its walls, doors, windows, and all furniture
  standing inside (island rooms ride along too). A wall shared with a
  neighbor stays with the neighbor — together with any door in it — and
  the moved room gets its own copy. Dropping a room edge-to-edge against
  another merges the touching walls into one shared wall; one undo step
  reverses the whole move
- **Room snapping** — while dragging, room corners snap onto nearby wall
  corners (the ring shows where the weld will land) and parallel walls
  snap collinear so partial-overlap docking produces a clean shared
  segment; hold Ctrl to drop freely
- **Rotate rooms** — a rotate handle appears on the selected room
  (15° detents with a stronger snap at right angles; Ctrl rotates
  freely), and `R` / `Shift+R` or the context menu rotate ±90°.
  Furniture inside orbits and turns with the room
- **Per-side wall finishes** — the single both-faces finish became
  *Finish front* / *Finish back* (like paint has always been): brick
  outside, wallpaper inside. Existing plans upgrade automatically
- **New wall finishes** — wallpaper (stripes and damask), wood panel,
  and plaster join brick, concrete, and tile
- **New floor materials** — herringbone parquet, oak and walnut
  laminate, beige and gray linoleum, and plaster (17 materials total),
  in a grouped floor picker (Wood / Tile / Stone / Smooth & soft)
- **Room types** — assign a type (Living room, Bedroom, Kitchen,
  Bathroom, Balcony, … 12 total) from the room panel. The type appears
  under the room label (and in exports), and picking a type suggests a
  matching floor material when none was chosen yet
- **Plan statistics** — with nothing selected, the properties panel now
  shows the room count, total area, and per-type area breakdown

### Changed

- Bundled templates now carry room types and show off per-side finishes
  (the studio gained an interior brick feature wall and a tiled
  bathroom partition)
- File format schema v5 (from v4): the both-faces wall `finish` field
  split into `finishFront`/`finishBack`. Older files open silently and
  upgrade on the next save, as always

## [0.7.0] - 2026-07-17

### Added

- **Area tool** (`A`, toolbar button) — click corners to trace a polygon
  that shows its area; close it by clicking the first point, double-click,
  or Enter (Backspace steps back, Esc clears). Traced areas persist with
  the plan, can be dragged as a whole, export with the drawing, and show
  area/perimeter in the properties panel
- **Dimension label levels** — *Show dimensions* grew from on/off into a
  ladder: Off / Walls / + Openings (door & window widths) / All (adds the
  selected item's width × depth). `Shift+D` cycles the levels; SVG/PNG/PDF
  exports follow the walls and openings levels
- **Measurements & labels visibility** (`Shift+A`, Options → View) — hide
  or show all kept measurements, traced areas, and text labels at once.
  Hidden annotations can't be clicked or box-selected; creating a new one
  turns the layer back on
- **Interface scale** (Options → Appearance) — 90% / 100% / 110% / 125% /
  150% presets scale the whole interface typography, including the
  in-canvas measurement pills and room labels (plan geometry and exports
  are unaffected)

### Changed

- **Furniture symbols now show their real shape** — the 2D plan no longer
  masks every item with a bounding rectangle: a corner sofa reads as an L,
  round tables / plants / lamps / stools as circles, the toilet as
  tank + bowl, the washbasin as its oval — in the editor, the catalog,
  the placement ghost, and every export

### Fixed

- Wall-length labels no longer double up with the live measurement pills
  while dragging furniture at any dimension level
- Per-item price/notes/material data (arriving in future releases) now
  survives copy/paste and duplication

### File format

- Documents save as schema **v4** (adds traced areas plus room-type and
  per-item metadata fields for upcoming releases). Older files open
  seamlessly and upgrade on the next save

## [0.6.0] - 2026-07-16

### Added

- **Arch Linux (AUR) packaging** — a `homeplanr-bin` PKGBUILD repacks the
  official `.deb` release; verified locally with full desktop integration
  (app icon, `.homeplanr` double-click, single-instance). Publication to
  the AUR itself will follow in a later release
- **Flatpak packaging** — a `com.kapuchai.homeplanr` manifest (GNOME 49
  runtime, minimal sandbox permissions; file access via desktop portals)
  builds and runs locally, including file association double-click and
  crash recovery inside the sandbox. Flathub submission to follow

### Changed

- **New app icon** — a blueprint-style tile (dark navy, drafting grid,
  white floor-plan glyph with a dimension line), redrawn at every size
  from small taskbar icons up; small sizes use a bolder simplified
  variant so the icon stays legible
- **Settings icon redrawn** — a solid gear silhouette replaces the
  spoked-circle icon
- **Toolbar right side reordered** — the 2D/3D switch now sits before the
  Help (?) and Settings buttons, which anchor the outer edge

### Removed

- **Planned in-app Russian translation dropped** — the interface stays
  English; the translation and runtime language switch were removed from
  the roadmap by user decision

## [0.5.0] - 2026-07-16

### Added

- **Trackpad-friendly scrolling** — new `Options → View → Mouse wheel`
  setting: keep the default (wheel zooms) or switch to *Pan (trackpad)*
  where two-finger scroll pans the plan and pinch (Ctrl+wheel) zooms.
  **Space+wheel now pans in any mode**; Shift+wheel still pans sideways.
  *Known issue: on some Linux trackpads the desktop app doesn't receive
  these scroll events yet, so the new modes may have no effect there —
  tracked for a future bug-fix release*
- **Sensible save/export folders** — exports (PNG/SVG/PDF/3D shots) open
  in Downloads, project save/open dialogs in Documents, and each dialog
  remembers the last folder you actually picked
- **Cyrillic (and more) in PDF exports** — a bundled Noto Sans subset is
  embedded in every PDF, so project names, room names, and labels in
  Russian and other non-Latin scripts render correctly everywhere,
  including the title block

### Fixed

- **Editing a wall then clicking another no longer misdirects the value** —
  a typed-but-uncommitted number (e.g. thickness) now always applies to
  the wall you typed it for, never to the one you clicked next, and never
  silently disappears. The same fix covers doors/windows, furniture,
  rooms, and multi-selections
- **Esc in a properties field reverts** the typed value instead of
  committing it (as always documented)
- **Arrow-key nudge is no longer vertically inverted** — ArrowUp moves
  the selection up on screen
- **Fit-mode PDF export produces a correct page** — previously the plan
  drew ~1 m wide off the sheet, leaving an effectively blank A4
- **Wall lengths no longer show twice** while dragging furniture with
  `Show dimensions` on (clearance distances stay)
- **Dimension labels sit predictably** — interior/orphan walls take a
  consistent side instead of a random one, and label pills are centered
  on their anchor
- **Keyboard-shortcuts window fits its content** — wider sheet, both
  columns visible, vertical scrolling only
- **Dark mode is legible** — room fills, the minor grid, furniture symbol
  detail, pill borders, and muted chrome text all lifted to real
  contrast (now pinned by tests); furniture keeps its light-mode look

### Changed

- Toolbar tools split into two groups: `Select · Measure · Text` and
  `Wall · Door · Window`
- The Options gear icon actually looks like a gear
- The `Dim` toggle left the bottom-right cluster (it lives in
  `Options → View` and on `Shift+D`)
- Motion timing now respects `prefers-reduced-motion`

No file-format change — `.homeplanr` files from 0.2.0+ open unchanged
(schema v3).

## [0.4.0] - 2026-07-16

### Added

- **Camera presets in 3D** — Top / Front / Iso / Reset buttons refit the
  view instantly (Top matches the 2D plan orientation); a one-time
  "drag orbits · wheel zooms" hint shows until your first orbit
- **Walk mode collides with furniture** — tables, sofas, and anything at
  body or head height now block you (and teleports); rugs pass underfoot
  and genuinely overhead shelves pass over
- **Export dialog** (`File → Export…`) — one place for PNG / SVG / **PDF**,
  print scale presets (Fit, 1:50, 1:100, 1:200 — SVG/PDF at true physical
  size, PNG at 150 DPI), grid toggle, and margin control
- **PDF export** — true vector output on A4 / A3 / Letter, portrait or
  landscape, with an optional title block (name · date · scale). If a fixed
  scale doesn't fit the paper you're asked to fit, clip, or cancel — never
  silently cropped
- **Bundled template plans** — `File → New: Studio 25 m²` and
  `New: 1-bedroom 45 m²` start you from a furnished starter plan (fresh
  untitled document each time)
- **Door swing preview** — the door tool shows the leaf and swing arc
  *before* you click, following the cursor's side of the wall
- **Real drag ghost** — dragging or placing furniture previews the item's
  actual plan symbol (with rotation/mirror) instead of a plain rectangle,
  and `R`/`F` update the ghost immediately
- **Resizable side panels** — drag the splitters next to the catalog and
  properties panels (double-click resets), or collapse either panel with
  the chevron; sizes persist per device

### Changed

- Cleaner catalog symbols — stacked parts no longer double-draw
  (the office chair reads as a chair, not a fan); the same derived symbol
  now also drives the drag ghost, editor, and exports through one shared
  transform
- Copy/paste is deterministic: pasting exactly over existing walls now
  preserves the existing rooms (names, floors) and never conjures phantom
  doors — pasted geometry always yields to what's already there
- Splitting a painted wall keeps paint and finish on both halves
- Walk-mode teleport rejections say "That spot is blocked" (it can be
  furniture now, not just walls)
- Opening a file or template now zooms to fit the plan
- All interface text lives in one table (`src/i18n`) — groundwork for
  future translations; no visible change

### Fixed

- Catalog cards no longer swallow clicks when the mouse moves 1px during
  the click
- Alignment guides use the wall-snapped orientation when a rotated item
  snaps against a wall (previously they could misalign by ~0.4 m)
- The File menu no longer shows the previous document's "Last saved" time
  after `File → New` / opening another file
- WASD no longer walks the camera behind an open dialog in 3D

*No file-format change — 0.3.0 files open unchanged (schema v3).*

## [0.3.0] - 2026-07-13

### Added

- **Marquee selection** — left-drag on empty canvas *or a room floor*
  rubber-band-selects with live highlighting; `Shift` adds to the selection,
  `Esc` cancels back to the previous one; `Ctrl+A` selects all; `Shift+2`
  zooms to the selection
- **Right-click context menu** — entity-aware and fully keyboard-navigable:
  duplicate/rotate/flip/copy furniture, **Split wall here**, align &
  distribute, **Duplicate room**, copy room, paste here, zoom commands
- **Batch property editing** — select several walls (or items, or openings)
  and edit thickness/height/finish/per-side paint (rotation/elevation/
  mirror; width/height) for all of them as ONE undo step
- **Persistent annotations** (schema v3) — `Enter` keeps a tape measurement
  as a dimension line (text always derived from its endpoints and your unit
  preference); a new **Text tool (T)** places world-sized labels; both
  select, drag (dimensions slide along their offset), edit in the panel,
  and always appear in PNG/SVG exports
- **Wall & room copy/paste + Duplicate room** — copying captures walls with
  their doors/windows, and whole rooms with contents and name/floor; pastes
  weld cleanly into existing geometry as a single undo step
- **Furniture power editing** — corner resize handles (the opposite corner
  stays anchored, rotation-aware), align left/right/top/bottom, distribute
  with equal gaps
- **Autosave** (opt-in, Options → Files) — debounced background saves to
  the current file that never conflict with explicit saves; "Saved · HH:MM"
  status flash, last-saved time in the File menu, non-modal failure notice
- **Keyboard shortcut sheet** (`?`), snap (`S`) and grid (`G`) toggles in
  the on-canvas cluster, a catalog search box, and a live angle readout
  while rotating furniture
- **Accessibility baseline** — dialogs trap and restore focus, every
  control has a visible accent focus ring, menus/toggles/swatches expose
  ARIA state and names, and every accent color meets WCAG AA contrast in
  both themes (enforced by a unit test)

### Changed

- Left-drag on empty canvas now **selects** (marquee) instead of panning —
  panning moved to right-drag, middle-drag, `Space`+drag, wheel and arrows
- Snapping is a **device preference** now (`S`), not a per-file setting —
  toggling it no longer dirties the file or creates undo entries. One-time
  effect: files saved with snapping off re-enable it once after upgrading
- Schema v3 (annotations; `settings.snapEnabled` removed) — older files
  open silently and upgrade on the next explicit save, as always
- UI polish: one radius/type scale, hover and disabled states everywhere,
  SVG icons instead of font glyphs, themed dark-mode scrollbars, long
  names clamp instead of overflowing

### Fixed

- **Silent save race** — edits made while a save was writing (worst under a
  Save-As dialog, which keeps the editor interactive) were marked saved but
  never reached the file; saves are now snapshot-consistent, serialized,
  and re-prompt for work that landed mid-save
- **Doors/windows were permanently deleted** when their wall was transiently
  dragged too short mid-gesture; live drags now never delete openings — the
  release decides
- Arrow-nudge cleanup: a drag, toolbar click, or `Ctrl+Z` right after
  nudging no longer loses the nudge or floods the undo history; `AltGr` no
  longer splits a nudge run (EU keyboard layouts)
- `R`/`F` rotate/flip the **placement ghost** even after the first
  placement; ghost state resets when switching catalog cards
- `Esc` on the crash-recovery prompt no longer discards the recovery data;
  overlapping dialogs queue instead of silently answering themselves
- Opening a file from the file manager mid-drag no longer silently does
  nothing, and concurrent open requests run in order
- Chorded mouse buttons (release left while right is held) no longer leave
  drags or pans tracking a lifted button; a second pointer (pen/touch) can
  no longer hijack or freeze a mouse drag

## [0.2.0] - 2026-07-12

### Added

- **Dark mode** — light/dark/system theme with six accent color presets
  (blue, violet, green, amber, rose, teal), applied across the 2D editor and
  the 3D scene; new Options dialog (gear button) for theme, accent, units,
  and wall dimensions — instant apply, persisted per device
- **Unit systems** — meters, centimeters, or feet-and-inches (quarter-inch
  rounding) in every panel field, canvas label, and measurement pill
- **Live measurement pills** while dragging: openings show their width plus
  gaps to neighboring openings and wall corners; furniture shows distances
  to the surrounding wall faces; wall/node drags show affected wall lengths
- **Tape measure tool** (`M`) — click-click with full snapping; the frozen
  measurement persists until `Esc` or a tool switch
- **Wall-dimension labels** — permanent, outside-of-room length labels
  (`Shift+D` or the Dim button)
- **2D navigation** — left-drag on empty canvas pans; arrow keys pan
  (`Shift` = faster); `+`/`−` keyboard zoom and an on-canvas zoom cluster
  (out / percent / in / fit)
- **Copy/paste and flip** — `Ctrl+C`/`Ctrl+V` pastes furniture at the
  cursor with relative multi-item layout and survives New/Open; `F` (or the
  panel toggle) mirrors an item in 2D and 3D
- **Per-side wall paint and finishes** — independent front/back paint from
  14 presets plus brick, concrete, and tile finishes; room-level "paint all
  walls facing this room"
- **Floor materials** — an 11-floor registry (wood, parquets, laminate,
  tiles, terracotta, marble, stone, concrete, carpet) with procedural
  textures in 3D and a matching room tint in 2D
- **Catalog: 18 → 35 items** — new kitchen, bathroom, living, office,
  dining, and bedroom pieces, each with an isometric card thumbnail
  rendered from its real 3D model (SVG symbol fallback when WebGL is
  unavailable)
- **First-person walk mode** — Walk button, then click a floor to glide to
  eye height; `WASD`/arrows move (`Shift` sprints), drag looks around,
  click teleports, `Esc` exits; disc collision slides along walls and
  passes only through doors
- **3D screenshot** — Save image button captures the current 3D view as PNG
- **Plan export** — File → Export PNG…/SVG… renders the 2D plan
  print-styled (always light theme, physical line widths, no editor chrome)
- **Schema v2 with silent forward migration** — a migration registry at the
  parse chokepoint upgrades v1 files and crash-recovery blobs on open, with
  byte-frozen golden fixtures pinning the path forever
- **`.homeplanr` file association** — double-click opens projects
  (registered by the Linux .deb/.rpm and the Windows installer); a second
  launch relays the file into the already-running window (single instance)

### Changed

- Metric areas always render as m² — cm mode no longer implies cm² areas
- The unit preference moved out of the project file into device-local app
  settings (schema v2 removes `settings.unitDisplay`)

### Fixed

- Wall-local frames were mirrored across the wall centerline, mismatching
  node patches at asymmetric T-junctions (and the sign per-side paint
  depends on); `+v` is now pinned to `+perp(a→b)`, the door-swing front
- Keys no longer reach editor tools behind dialogs — e.g. `Delete` behind
  the unsaved-changes confirm
- Editing and navigation shortcuts no longer act on the hidden 2D scene
  while the 3D view is active (only file accelerators stay live in 3D)
- Mixed indexed/non-indexed part geometries made `mergeGeometries` fail and
  silently dropped whole catalog material groups in 3D
- Flat furniture no longer reloads taller than saved: the file validator's
  height floor is 0.01 m (a 0.02 m rug used to come back as 0.1 m)

## [0.1.0] - 2026-07-12

First release. 2D floor-plan editor with click-click wall drawing (live
lengths, 0/45/90° assist, mitered joins), automatic room detection with
areas, doors and windows that slide along walls, rich snapping, and
one-undo-step-per-gesture history; an 18-item procedural furniture catalog;
a live 3D view of the same document (openings cut, glass, soft shadows,
fitted orbit camera); local-first `.homeplanr` JSON files with native
dialogs, recents, crash recovery, and an unsaved-changes guard; Linux
(.deb/.rpm/AppImage) and Windows (NSIS) packaging via CI with e2e smoke
tests and perf budgets.

[0.3.0]: https://github.com/kapuchai/homeplanr/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kapuchai/homeplanr/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kapuchai/homeplanr/releases/tag/v0.1.0
