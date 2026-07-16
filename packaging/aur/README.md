# AUR packaging — homeplanr-bin

`PKGBUILD` repacks the official `.deb` release asset for Arch. It is kept in
this repo as the source of truth; the AUR git repo mirrors it.

Status (2026-07-16, v0.6.0 session): **local-only** — verified by building
and installing on an Arch box. Publishing to AUR (account + CI job) was
deferred by the user; steps below are the runbook for that later session.

## One-time AUR setup (user)

1. Create an AUR account at https://aur.archlinux.org and add an SSH key.
2. `git clone ssh://aur@aur.archlinux.org/homeplanr-bin.git` — cloning a
   non-existent package name CREATES it on first push.
3. For CI publishing later: add the private key as the `AUR_SSH_PRIVATE_KEY`
   repo secret; the release.yml job uses
   `KSXGitHub/github-actions-deploy-aur` (job not written yet — deferred).

## Per-release manual publish

Run after the GitHub release is PUBLISHED (draft assets are not
downloadable by makepkg):

```sh
cd packaging/aur
# 1. bump pkgver=, reset pkgrel=1
updpkgsums                      # pacman-contrib; replaces the SKIP sums
makepkg -f                      # test build from the real release asset
makepkg --printsrcinfo > .SRCINFO
# 2. copy PKGBUILD + .SRCINFO into the AUR clone, commit, push
```

## Local verification (no published release needed)

makepkg picks up source files already present next to the PKGBUILD before
trying to download, so:

```sh
npm run tauri build             # fresh local .deb
cp src-tauri/target/release/bundle/deb/homeplanr_<ver>_amd64.deb packaging/aur/
cp LICENSE packaging/aur/LICENSE-v<ver>
cd packaging/aur && makepkg -f  # then: sudo pacman -U homeplanr-bin-<ver>-1-x86_64.pkg.tar.zst
```

Post-install checks (mirror RUNBOOK gates 4/8): app grid entry + icon,
`xdg-mime query filetype something.homeplanr` → `application/x-homeplanr`,
double-click a `.homeplanr` file (cold start), double-click again with the
app running (second-instance relay into the existing window).

Note: `sha256sums=('SKIP' 'SKIP')` is committed here because the sums can
only be pinned against published assets; `updpkgsums` pins them at publish
time. Do NOT push SKIP sums to AUR.
