# Attribution

## Toolbox-bus brand mark

- Files: `static/brand/toolbus-mark.svg` (full three-quarter mark),
  `static/brand/toolbus-glyph.svg` and `static/favicon.svg` (side-profile
  glyph), `static/favicon.ico`, `static/apple-touch-icon.png`,
  `static/icon-192.png`, `static/icon-512.png`, `static/og/toolbus-1200x630.png`,
  and the inline copies in `src/lib/components/{ToolBusMark,BusMark}.svelte`
- Source: hand-authored SVG after the club's logo sketch
  (`toolbus_logo_sketch1.png`, received 2026-09-19); colours sampled from it
- Author of the sketch: TODO(jess) confirm and record once naming consent is
  in hand
- Rights: project-owned

The vectors were drawn by hand (no autotrace). The rasters are renders of the
committed SVGs with the `--tb-*` variables substituted for their light values,
made with resvg 0.47 and ImageMagick 7 from `nix shell nixpkgs#resvg
nixpkgs#imagemagick`:

```sh
resvg -w 16 glyph.svg f16.png; resvg -w 32 glyph.svg f32.png; resvg -w 48 glyph.svg f48.png
magick f16.png f32.png f48.png static/favicon.ico
resvg -w 180 apple-touch.svg static/apple-touch-icon.png   # glyph on the #f4f1e8 page ground, 81% inset
resvg -w 192 glyph.svg static/icon-192.png; resvg -w 512 glyph.svg static/icon-512.png
resvg --use-font-file fraunces.ttf -w 1200 docs/brand/toolbus-og-source.svg static/og/toolbus-1200x630.png
```

`fraunces.ttf` is the shipped `@fontsource-variable/fraunces` latin woff2
decompressed with `woff2_decompress`; the OG source is kept in `docs/brand/`
and is not served.

## Great Falls historical image

- Files: `static/photos/great-falls-lewiston-1930s-{640,1280,1920}.jpg` and the
  matching `.webp`
- Title: *The Falls and Old Man, Auburn and Lewiston, Maine*
- Publisher: Tichnor Brothers, Inc.
- Collection: Boston Public Library, Tichnor Brothers Collection no. 69902
- Source: <https://www.digitalcommonwealth.org/search/commonwealth:5t34tc98g>
- Rights: public domain / no known copyright restrictions

The published files are downscaled renditions of the 3070x1851 source held by
the collection above — width-limited only, with no crop, tone or content change.
Serving the master directly cost every visitor 2.35 MB against the 51 KB the
same figure needs at its rendered size (TIN-3932), so the master is no longer
part of the static tree. Re-fetch it from the source URL above if a larger
rendition is ever needed.

Quality ramps down with width on purpose: the wide candidates are only ever
selected at high device-pixel ratios, where the artefacts are sub-pixel. The
exact values used, so the set is reproducible from this file alone:

| width | `sips` JPEG `formatOptions` | `cwebp -q` |
| --- | --- | --- |
| 640 | 80 | 78 |
| 1280 | 74 | 72 |
| 1920 | 66 | 64 |

WebP is encoded from a PNG intermediate rather than from the JPEG, so it does
not inherit JPEG's artefacts. With `master` the re-fetched source and `jq`/`wq`
the two numbers from the row above:

```sh
base=static/photos/great-falls-lewiston-1930s
for spec in 640:80:78 1280:74:72 1920:66:64; do
  width=${spec%%:*}; rest=${spec#*:}; jq=${rest%%:*}; wq=${rest##*:}
  sips -Z "$width" --setProperty format png "$master" --out "/tmp/w$width.png"
  sips --setProperty format jpeg --setProperty formatOptions "$jq" \
    "/tmp/w$width.png" --out "$base-$width.jpg"
  cwebp -q "$wq" -m 6 -metadata none "/tmp/w$width.png" -o "$base-$width.webp"
done
```

Both assets are stored locally; the public page makes no third-party image
requests. See `NOTICE` for the concise distribution notice.

## ALTCHA widget

- Files: `static/vendor/altcha/altcha.js` and `static/vendor/altcha/LICENSE`
- Protocol/reference: ALTCHA v3.2.0
- License: MIT
- Upstream: <https://altcha.org>

## Bus photographs

- Files: `static/photos/goals/bus-side-bikes-1280.webp`,
  `static/photos/goals/bus-interior-seats-1280.webp`,
  `static/photos/goals/bus-interior-cleared-1280.webp`,
  `static/photos/goals/bus-on-lawn-1280.webp`,
  `static/photos/goals/legacy-hardware-in-hand-1280.webp`,
  `static/photos/log/2026-08-11-how-tools-will-move-1280.webp`,
  `static/photos/log/2026-09-07-alex-the-wheel-maven-1280.webp`
- Author: Jess Sullivan (operator-shot), August and September 2026
- Rights: project-owned photographs

Published renditions are 1280w downscales of the metadata-stripped 2000w webp
masters (themselves encoded from the phone originals with `cwebp -metadata
none`). Reproduction per file: `sips -s format png` to a PNG intermediate,
then `cwebp -q 72 -m 6 -resize 1280 0 -metadata none`. Each published file was
verified metadata-free with `webpmux -info` (no EXIF, XMP, or ICC chunks).
The phone originals (HEIC) are never published without an EXIF/colorspace
audit; the source masters live off-repo on operator storage.

The two September 2026 files were encoded straight from the phone originals
(Display P3 HEIC): `sips --matchTo "/System/Library/ColorSync/Profiles/sRGB
Profile.icc" -s format png` to an sRGB PNG intermediate, then the same
`cwebp -q 72 -m 6 -resize 1280 0 -metadata none` line, verified with
`webpmux -info` (no EXIF, XMP, or ICC chunks).

## Port-side shelves: renderings and cut sheet

- Files: `static/photos/log/2026-09-19-port-side-shelves-1280.webp`,
  `static/photos/log/2026-09-19-port-side-shelves-iso-1280.webp`,
  `static/photos/log/2026-09-19-port-side-shelves-iso-rear-1280.webp`,
  `static/photos/log/2026-09-19-port-side-shelves-front-1280.webp`,
  `static/photos/log/2026-09-19-port-side-shelves-top-1280.webp`
  (the in-bus render also serves the Fusion workshop pane),
  `static/cad/port_side_shelves_cut_list.pdf`
- Source: the club's public cad repository, `bus_mods/jesssullivan/port_side_shelves`
  at commit `63df5863f6cfc6fbd37194e89e488c57053f14eb` (renders from `images/`, the PDF is `pdfs/cut_list.pdf`
  byte for byte; its LaTeX source is `docs/cut_list.tex`, built with tectonic)
- Author: Jess Sullivan, rendered from the Fusion 360 model, 2026-09-14
- Rights: project-owned

Renditions: `sips -s format png` to a PNG intermediate, then `cwebp -q 72 -m 6
-resize 1280 0 -metadata none`, verified metadata-free with `webpmux -info`.
