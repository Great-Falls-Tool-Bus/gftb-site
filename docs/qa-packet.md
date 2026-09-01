# QA evidence packet

`just qa-packet` produces the evidence a reviewer reads instead of re-running
the acceptance suite by hand: every prerendered route photographed at the
acceptance widths (spec §3), plus a receipt saying what the gates reported for
exactly those bytes. Pull requests run the same recipe in the `qa-look` job and upload `qa-packet/<head-sha>/` as the exact-head human-review carrier.

```bash
just qa-packet            # captures on port 3355
just qa-packet 3411       # captures on a port you choose
```

**Remote-only (operator ruling 2026-09-01):** `qa-packet`, `qa-packet-diff`,
and every other heavy recipe refuse to run off-runner via
`scripts/remote-only-guard.sh` (exit 3). The `qa-look` job is the packet
producer: it runs this recipe at the exact PR head and uploads
`qa-packet/<head-sha>/` as a workflow artifact — download that carrier
instead of capturing locally.

Pick a free port. Lanes commonly hold 3000 (the Playwright CI port), 3111, 3199
and 3277, and the recipe deliberately refuses to reuse whatever is already
listening: an evidence packet of somebody else's build is worse than no packet.

## What the recipe does

1. `just build` — Bazel static build, materialize, and the `leak-scan` gate over
   the built tree. The packet is evidence for **this** artefact, so the artefact
   is produced first.
2. `just check` — the four repo gates (eslint, prettier, svelte-check, the unit
   suite).
3. `just preview-e2e <port>` in the background — the same preview machinery
   Playwright uses in CI, on the port you gave it.
4. The browser acceptance suite against that preview, through
   `playwright.qa-packet.config.ts`. That file is a thin variant of
   `playwright.config.ts` with the web server removed and the base URL taken
   from the environment. **`playwright.config.ts` itself is never touched**; the PR-only `qa-look` job invokes this dedicated packet recipe after the reusable CI succeeds.
5. `scripts/qa-packet.mjs` — the screenshots, `manifest.json` and `INDEX.md`.
6. Teardown. The recipe kills only the preview it started.

A failing acceptance suite does not abort the capture — a packet showing what a
regression looks like is exactly what you want — but the recipe still exits
non-zero.

## Packet layout

```
qa-packet/<40-character head sha>/
  INDEX.md        # human entry point: receipt table + image table
  manifest.json   # machine entry point: matrix, per-image sha256, receipt
  shots/*.png
```

`qa-packet/` is git-ignored. A packet is fully regenerable from a SHA, so it is
evidence, not source. The output root is fixed at `qa-packet/<40-lowercase-hex-sha>`;
`--out` is rejected, and an existing packet fails closed instead of being deleted
or replaced.

### The capture matrix

Per route, per colour scheme (`light` and `dark` are both captured even where
the page paints the same in each — "unchanged" is evidence too):

| Rows | What |
| --- | --- |
| 320, 375, 768, 1280 | the acceptance widths in CSS pixels; 320 is the WCAG 1.4.10 reflow floor |
| 640, 384, 320 | 200% zoom on a 1280, 768 and 640 pixel device, derived as half the physical width exactly as the acceptance suite derives it |
| 375, 1280 | `prefers-reduced-motion: reduce` |
| 1280 | keyboard focus on the primary call to action, and on the contact form submit |

Focus shots are reached by pressing Tab, never by a programmatic `.focus()`:
`:focus-visible` is a statement about how focus arrived, and a ring a keyboard
user never sees is not evidence.

### What makes a packet comparable

Fixed viewport and `scale: css` (so a retina laptop and a CI runner agree),
animations disabled and caret hidden at capture time, `document.fonts.ready`
awaited, the network idle before and after the page settles, every off-origin
request aborted, and the one third-party the page talks to answered from a fixed
local stub. The only fields that legitimately move between two captures of the
same tree are the manifest's timestamp and the receipt's timings.

### What is deliberately absent

The branch name. Branch names routinely carry issue-tracker IDs, and the shared
leak rules forbid those in anything this repository emits. The head SHA
identifies the packet.

## Leak scanning the packet

`INDEX.md` and `manifest.json` are run through the same
`scripts/lib/leak-scan.mjs` the published build is scanned with. If anything
trips a rule the two files are not written and the recipe fails.

One documented substitution: the packet's own head SHA is replaced with a
placeholder before scanning. The shared rules treat any 40-character hex string
as a repository pointer, which is right for the published site and wrong for a
packet whose whole purpose is to say which commit it photographed. Exactly that
one literal is exempt; every other 40-hex string in the packet is still a
finding.

## Comparing two packets

```bash
just qa-packet-diff qa-packet/<baseline-sha> qa-packet/<candidate-sha>
```

Both arguments must be exact packet roots under this checkout's
`qa-packet/<40-lowercase-hex-sha>/`; arbitrary and cross-worktree roots are
rejected before any image is read. Manifest shot IDs and paths are fixed too, so
packet metadata cannot steer a read or diff write outside that root. The output is derived as
`qa-packet/diff/<baseline-12hex>__<candidate-12hex>/` and an existing diff fails
closed instead of being deleted or replaced.

Output lands in `qa-packet/diff/<baseline-short>__<candidate-short>/` as one
`<shot-id>.diff.png` per **changed** image plus a `DIFF.md` table sorted by
percentage of pixels changed. Unchanged pairs produce no file, so the directory
listing is itself the finding. Magenta marks a changed pixel; everything else is
the candidate image dimmed to grey.

A pixel counts as changed when any channel moves by more than 8/255. Override
with `--threshold N`.

No image library was added for this. `pixelmatch` and `pngjs` are not in the
dependency tree, and a QA convenience is not a good reason to put two more
packages into a site whose posture is "ship less". Chromium is already pinned
here for the acceptance suite, and a browser is a complete PNG decoder and
encoder, so the comparison runs inside it.

## The human row

Spec §9(6) is a human row and stays one. The packet proves what the page looked
like under a machine-checkable matrix; it cannot tell you whether the page reads
well, whether the tone is right, or whether the focus order feels sane to
somebody actually driving it.

Layer the gstack `/browse` annotated pass on top for that row:

1. Run `just qa-packet <port>` first and leave the numbers in front of you. The
   packet is the "what changed" input to the human pass, not a replacement for
   it.
2. Take an annotated `/browse` pass over the same preview — that skill drives a
   headless browser, annotates screenshots, and produces before/after diffs and
   structured state, which is the part a static screenshot matrix cannot cover:
   hover and active states, scroll behaviour, the widget mid-flight, and any
   judgement call about wording or hierarchy.
3. Paste the packet's `INDEX.md` receipt table into the review and link the
   annotated pass beside it. The machine table and the human note are two
   different claims and should read as two different claims.

Never mistake a green packet for a completed §9(6). The packet's own receipt
says so in the row under the table.
