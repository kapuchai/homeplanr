# homeplanr — Runbook

Working notes for future development sessions. The full v1 design rationale
lives in the original plan; day-to-day, this file + `src/model/README.md`
(conventions) are what you need.

## State (as of v0.1.0, 2026-07-12)

Shipped: 2D editor (walls/doors/windows/furniture, snapping, undo), 3D view,
18-item procedural catalog, native `.homeplanr` persistence with crash
recovery, Linux (.deb/.rpm/AppImage) + Windows (NSIS) packaging via CI.
All milestones M0–M6 of the v1 plan are complete and user-verified.

## Commands

| Task | Command |
|---|---|
| Dev (native window, HMR) | `npm run tauri dev` |
| Dev (browser only) | `npm run dev` |
| Unit tests (249) | `npm test` |
| E2E smoke | `npx playwright test --project=chromium` (webkit only works in CI — Arch lacks its Ubuntu-named host libs) |
| Typecheck / lint | `npm run typecheck` / `npm run lint` |
| Local bundles | `npm run tauri build` (deb/rpm); AppImage on this Arch box needs `APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1 npm run tauri build -- --bundles appimage` (no fuse2 installed) |
| Run local AppImage | `./src-tauri/target/release/bundle/appimage/*.AppImage --appimage-extract-and-run` |
| Release | push a `v*` tag → `release.yml` builds both OSes + drafts the GitHub release; dry-run anytime via `gh workflow run release.yml` |

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
6. Invariant: migrations are silent — old files open clean and upgrade on
   the next explicit save.

## Verification gates (used at every milestone; keep using them)

1. `npm test` + typecheck + lint + build — all zero-noise.
2. Chromium e2e locally; webkit e2e rides CI.
3. `npm run tauri dev` manual pass for anything interaction-heavy.
4. Packaged AppImage pass before tagging (dev and package have SEPARATE
   localStorage — recovery/recents don't carry over).
5. CI green before considering a push done (`gh run watch`).

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
- **Door-arc sweep flags are empirically pinned** (two user checks, y-down
  and y-up). Verify visually after any viewport-transform change; don't
  re-derive from theory.
- pkill sweeps of `vite`/`tauri dev` return exit 143/144 in this harness —
  harmless.

## Session workflow that worked

Milestone-sized commits, each: implement → all gates green → user-verified
in the running app → commit with a detailed message → push → `gh run watch`.
User visual checks caught what tests couldn't (mirror chirality, arc sweep,
pinch behavior, selector collisions) — always do the human pass for UX.

## Backlog (user-acknowledged, post-v0.1.0)

- **Furniture symbol quality**: derived symbols are correct but busy for
  some items; consider per-part `symbolWeight`/outline-merging or curated
  overrides via the (deprecated, still-typed) `symbol2d` field.
- Verify pinch-zoom fix across DEs (GNOME X11/Wayland, KDE); wry follow-up
  if `zoomHotkeysEnabled` proves insufficient.
- Strip legacy `symbol2d` data from item files; make the field optional.
- Drag-from-catalog ghost could show the real symbol (currently plain rect).
- Icon polish + proper AUR/Flatpak packaging for Arch users.
- Plan's v2 seams: GLTF furniture (`gltfUrl` + realize cache), walkthrough
  camera, multi-floor (`floors[0]` wrap), opening re-hosting, marquee select.
