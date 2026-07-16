#!/usr/bin/env bash
# Regenerate the full app icon set from the committed SVG sources.
# Sources: src-tauri/icons/src/master.svg (>=64px art, blueprint grid)
#          src-tauri/icons/src/small.svg  (<=48px art: no grid, bolder)
# Needs: rsvg-convert (librsvg), magick (imagemagick), npx tauri (icns/tiles).
# The two-variant split is deliberate — the grid muddies at small sizes;
# keep any future redesign two-variant too.
set -euo pipefail
cd "$(dirname "$0")/.."
ICONS=src-tauri/icons
SRC=$ICONS/src
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 1. tauri icon generates the platform set (icns, ico, Windows Store tiles)
#    from the master art; small sizes get overwritten below.
rsvg-convert -w 1024 -h 1024 "$SRC/master.svg" -o "$TMP/master-1024.png"
npx tauri icon "$TMP/master-1024.png" -o "$ICONS" >/dev/null
rm -rf "$ICONS/android" "$ICONS/ios"   # desktop-only app

# 2. Small sizes from the small-variant art.
rsvg-convert -w 32 -h 32 "$SRC/small.svg" -o "$ICONS/32x32.png"

# 3. Rebuild icon.ico: small art for 16/24/32/48, master art for 64/128/256.
for s in 16 24 32 48; do rsvg-convert -w $s -h $s "$SRC/small.svg" -o "$TMP/ico-$s.png"; done
for s in 64 128 256;  do rsvg-convert -w $s -h $s "$SRC/master.svg" -o "$TMP/ico-$s.png"; done
magick "$TMP"/ico-{16,24,32,48,64,128,256}.png "$ICONS/icon.ico"

# 4. Proper hicolor sizes for Linux bundles (referenced in bundle.icon).
rsvg-convert -w 256 -h 256 "$SRC/master.svg" -o "$ICONS/256x256.png"
rsvg-convert -w 512 -h 512 "$SRC/master.svg" -o "$ICONS/512x512.png"

# 5. Web favicon = master art.
cp "$SRC/master.svg" public/favicon.svg

echo "Icon set regenerated from $SRC"
