#!/bin/bash
set -e

# Post-merge setup for Guadalupe Sentinel.
# Idempotent — safe to run after every task merge.

# 1. Install JS deps (skip if package-lock unchanged would still no-op fast).
if [ -f package.json ]; then
  npm install --no-audit --no-fund --silent
fi

# 2. Re-render PWA icon PNGs from SVG sources if either source changed
#    or any target is missing. Uses ImageMagick which is on PATH in Nix.
if [ -f public/icon.svg ] && command -v magick >/dev/null 2>&1; then
  mkdir -p public/icons
  needs_render=0
  for f in public/icons/icon-192.png public/icons/icon-512.png \
           public/icons/icon-192-maskable.png public/icons/icon-512-maskable.png \
           public/icons/apple-touch-icon-180.png public/icons/favicon-32.png; do
    if [ ! -f "$f" ] || [ public/icon.svg -nt "$f" ] || [ public/icon-maskable.svg -nt "$f" ]; then
      needs_render=1
      break
    fi
  done
  if [ "$needs_render" = "1" ]; then
    magick -background none -resize 192x192 public/icon.svg          public/icons/icon-192.png
    magick -background none -resize 512x512 public/icon.svg          public/icons/icon-512.png
    magick -background none -resize 180x180 public/icon.svg          public/icons/apple-touch-icon-180.png
    magick -background none -resize 32x32   public/icon.svg          public/icons/favicon-32.png
    magick -background none -resize 192x192 public/icon-maskable.svg public/icons/icon-192-maskable.png
    magick -background none -resize 512x512 public/icon-maskable.svg public/icons/icon-512-maskable.png
  fi
fi

echo "post-merge: ok"
