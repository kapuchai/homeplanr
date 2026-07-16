# Flatpak packaging — com.kapuchai.homeplanr

Manifest wraps the released `.deb` (same payload the AUR `-bin` package
uses). Runtime `org.gnome.Platform//49` — it ships `libwebkit2gtk-4.1`,
which the Tauri binary needs (verified 2026-07-16).

Status (2026-07-16, v0.6.0 session): built + verified locally. Flathub
submission is post-release (their review takes time) — submit after the
GitHub release is published, tracking in the next session. Flathub will
additionally want screenshots in the metainfo; add them at submission.

## Local build + install (per-user, no sudo)

Tooling (one-time): `flatpak remote-add --user --if-not-exists flathub
https://dl.flathub.org/repo/flathub.flatpakrepo && flatpak install --user
flathub org.flatpak.Builder org.gnome.Platform//49 org.gnome.Sdk//49`

The committed manifest points at the published release asset. To verify
against a locally built .deb instead (e.g. before the release exists):

```sh
npm run tauri build     # produces src-tauri/target/release/bundle/deb/*.deb
cd packaging/flatpak
# make a scratch manifest whose deb source is the local file:
sed -e 's|^        url: .*|        path: ../../src-tauri/target/release/bundle/deb/homeplanr_<ver>_amd64.deb|' \
    -e '/sha256: TODO/d' com.kapuchai.homeplanr.yml > local.yml
flatpak run org.flatpak.Builder --user --install --force-clean \
  build-dir local.yml
flatpak run com.kapuchai.homeplanr
```

Note: a locally (Arch-)built .deb links the build host's glibc, which may be
NEWER than the runtime's — if the app fails to start with a glibc symbol
error, use the CI-built Ubuntu 22.04 .deb (a `gh workflow run release.yml`
dry-run artifact) instead; the published release assets are CI-built and
never hit this.

## Publish flow (post-release)

1. `sha256sum` the published `homeplanr_<ver>_amd64.deb`, set it in the
   manifest, bump the url version, add a `<release>` entry to metainfo.
2. Validate: `flatpak run --command=flatpak-builder-lint org.flatpak.Builder
   manifest com.kapuchai.homeplanr.yml` (and `appstream` on the metainfo).
3. First time: fork flathub/flathub, PR the manifest per their submission
   docs. Later: updates go to the app's flathub repo.

## Sandbox notes (see RUNBOOK "Flatpak" section for the verified list)

- File dialogs ride the XDG document portal; persisted-scope re-grants
  across restarts. NO blanket `--filesystem` — keep it that way.
- Single instance is D-Bus based; the app id is the prefix so the default
  session-bus policy allows owning it.
- localStorage/app data live under `~/.var/app/com.kapuchai.homeplanr/` —
  a THIRD storage root besides dev and system-package installs.
