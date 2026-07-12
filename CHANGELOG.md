# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/kapuchai/homeplanr/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kapuchai/homeplanr/releases/tag/v0.1.0
