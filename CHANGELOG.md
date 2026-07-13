# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
