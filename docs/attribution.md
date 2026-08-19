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
Serving the master directly cost every visitor 2.35 MB (TIN-3932), so it is no
longer part of the static tree; re-fetch it from the source URL if a larger
rendition is ever needed, and regenerate with:

```sh
sips -Z <width> --setProperty format png <master> --out /tmp/w.png
sips --setProperty format jpeg --setProperty formatOptions <q> /tmp/w.png --out <name>-<width>.jpg
cwebp -q <q> -m 6 -metadata none /tmp/w.png -o <name>-<width>.webp
```

Both assets are stored locally; the public page makes no third-party image
requests. See `NOTICE` for the concise distribution notice.

## ALTCHA widget

- Files: `static/vendor/altcha/altcha.js` and `static/vendor/altcha/LICENSE`
- Protocol/reference: ALTCHA v3.2.0
- License: MIT
- Upstream: <https://altcha.org>
