# homeplanr

A fast, local-first home planning app — draw floor plans in 2D, furnish them
from a built-in catalog, and walk around the result in 3D. Built with
[Tauri 2](https://tauri.app), React, and three.js. Linux first, Windows too.

> 🚧 v0.1 — young but functional. Feedback and issues welcome.

## Features

- **2D floor-plan editor** — click-click wall drawing with live lengths and
  0/45/90° assist, mitered wall joins, automatic room detection with areas,
  doors and windows that slide along walls, snapping (nodes, grids, alignment
  guides, back-against-wall capture with corner composition)
- **Furniture catalog** — 18 procedural items (living, bedroom, dining,
  kitchen, bathroom, office); drag onto the plan or click-to-place; resize,
  rotate, duplicate, nudge
- **3D view** — the same document rendered live: walls with door/window
  openings cut, glass and frames, soft shadows, per-room floor materials;
  orbit/zoom with a fitted camera
- **Local-first files** — projects are plain-JSON `.homeplanr` files with
  native Save/Open dialogs, recents, autosaved **crash recovery**, and an
  unsaved-changes guard; no accounts, no cloud, works offline
- **Deep undo/redo** — every gesture is exactly one undo step

## Controls

| Input | Action |
|---|---|
| `V` / `W` / `D` / `N` | Select · draw walls · place door · place window |
| Click-click (wall tool) | Place wall points; click the start to close a room; `Enter` ends; `Backspace` steps back |
| Drag / `R` / handle | Move · rotate 90° · free-rotate with 15° detents (`Ctrl` = free) |
| `Ctrl+D` / arrows | Duplicate · nudge 1 cm (`Shift` = 10 cm) |
| `Del` | Delete selection (walls cascade their openings) |
| Wheel / `Ctrl`+wheel | Zoom to cursor (touchpad pinch works) |
| `Shift`+wheel / middle-drag / `Space`+drag | Pan |
| `Shift+1` | Zoom to fit |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | New · open · save · save as |
| `Esc` | Cancel gesture → leave tool → deselect |
| Alt+click or repeat-click | Cycle overlapping items (some Linux WMs grab Alt+drag — repeat-click always works) |

Two-finger touchpad scroll **zooms** (CAD convention); pan with `Space`-drag.

## Install

Grab the latest build from [Releases](https://github.com/kapuchai/homeplanr/releases):

- **Linux `.deb`** (Debian/Ubuntu) — recommended; small (~10 MB), uses the
  system WebKitGTK: `sudo apt install ./homeplanr_*.deb`
- **Linux AppImage** — self-contained (~70–120 MB). Requires the FUSE 2
  runtime: Arch `sudo pacman -S fuse2`, Debian/Ubuntu
  `sudo apt install libfuse2` — or run with `--appimage-extract-and-run`
- **Windows installer** (`*-setup.exe`) — builds are **unsigned**, so
  SmartScreen will warn: choose *More info → Run anyway*. First install
  downloads the WebView2 runtime if missing (needs network once)

**Linux troubleshooting:** if the 3D view reports a WebGL failure, launch with
`WEBKIT_DISABLE_DMABUF_RENDERER=1 homeplanr` (or
`WEBKIT_DISABLE_COMPOSITING_MODE=1`). The 2D editor works regardless.

## Develop

Prerequisites: Node ≥ 22 (`.nvmrc` says 26), Rust stable + cargo, and on
Linux the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
(`webkit2gtk-4.1`, `gtk3`, `librsvg`, `base-devel`/build-essential…).

```sh
git clone https://github.com/kapuchai/homeplanr && cd homeplanr
npm ci
npm run tauri dev      # native window with hot reload
npm run dev            # browser-only mode (file dialogs become downloads)
npm test               # vitest — geometry/model/store/tool suites
npm run typecheck && npm run lint
```

The file format is versioned, pretty-printed JSON — a `.homeplanr` file is
diffable and safe to keep in git.

### Architecture (short version)

One document store (zustand + immer + zundo) is the single source of truth;
`src/geometry/` derives mitered wall outlines, detected rooms, and 3D wall
prisms from it with per-entity reference stability; the SVG 2D editor and the
react-three-fiber 3D view are two renderers over the same derived data.
Conventions (units, coordinate frames, winding) live in `src/model/README.md`
and are pinned by tests.

## License

[MIT](LICENSE)
