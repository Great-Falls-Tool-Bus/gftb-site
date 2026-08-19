# Attribution

## Bus silhouette

- File: `static/logo/bus-silhouette.svg`
- Source: <https://commons.wikimedia.org/wiki/File:Bus_Silhouette.svg>
- Author: unknown
- License: CC0 public-domain dedication

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
