# House Design Canon

Reusable craft guidance for every spoke spawned from `site.scaffold`. This is
not a brand sheet (colors, logo, copy live per-site under
`src/lib/styles/themes/` and `src/routes/+page.svelte`). It is the small set of
craft rules that keep spokes reading as intentional design rather than
generated-looking filler. The house theme in `src/app.css` already embodies
most of it; this doc names the rules so a customizing agent does not
accidentally undo them.

The formal decision record is
[`docs/decisions/design-canon.md`](./decisions/design-canon.md). This file is
the practical how-to.

## 1. Glass is a featured effect, never a default opaque panel

Translucency is a deliberate focal treatment, applied to a small number of
surfaces that earn it (the sticky AppBar, an occasional overlay). It is worth
doing well precisely because it is rare.

- Back a glass surface with real `backdrop-filter: blur()` plus a
  `color-mix(... transparent)` fill, and gate it behind
  `@supports (backdrop-filter: ...)` so browsers without it get a solid,
  legible fallback rather than an unreadable low-alpha panel. The
  `.saturn-nav` block in `src/app.css` is the reference implementation.
- Never reach for glass as a way to "make a box look nicer." If a region does
  not need to float translucently over moving content behind it, it should be a
  plain opaque surface token, not a washed-out semi-transparent one.
- Drop the blur under `prefers-reduced-motion: reduce` (glass over scrolling
  content is a motion effect for some users). `src/app.css` already does this.

## 2. Background fill is a smell; intentional bleeds are craft

The tell of generated-looking layout is gratuitous background-fill layering:
stacking tinted rectangles behind content to "separate" regions that were
already fine. A background region should be one of two things and nothing in
between:

- **Not separated at all.** Most sections read fine on the page background.
  Delineate with type scale, whitespace, and rhythm, not a box.
- **A real, intentional shape.** A full-bleed band, a complementary color
  bleed, a deliberate geometric field, executed with genuine UX and UI intent
  (edge-to-edge, considered color relationship, a reason to exist). The warm
  radial halo on `.saturn-nav::after` is an example: it is a brand motif with a
  purpose, not a fill behind a paragraph.

Delineating an *element* (a code block, a callout, a form field) is fine. The
smell is specifically the redundant tinted panel wrapped around a region for no
reason. When in doubt, delete the background and see if anything was lost.

## 3. Zero border-radius homogeneity

Radius must be a deliberate, consistent system, never a mismatched grab bag.
The most common generated-looking artifact is one rounded card sitting next to
a sharp one, or a `rounded-xl` container holding `rounded-sm` children with no
rhythm between them.

- Pick a radius scale and apply it by role, not by whim. The house baseline is
  sharp-to-tight: small radii (`0.25rem`) on inline chrome (inline code,
  focus rings), slightly larger (`0.5rem`) on code blocks, and square edges on
  full-bleed structural surfaces.
- Do not mix a rounded family and a sharp family in the same visual cluster.
- Beware the Tailwind-v4 `@source` scar documented in `src/app.css`: when
  Skeleton utility classes are not seen at build time, `rounded` silently
  compiles to `0` radius, producing exactly this mismatch. Keep the `@source`
  line pointed at the vendored Skeleton dist.

## 4. Card-reduction and de-smell discipline

Card walls (a grid of identically-boxed tiles) are the single loudest
generated-looking signal. Reduce them.

- Do not wrap every item in a card. Prefer a definition list (`<dl>` with
  `<dt>`/`<dd>`) or plain typographic hierarchy for structured
  term-and-detail content. It is more semantic, more accessible, and reads as
  authored.
- Never double-box: a card inside an accordion, or a bordered panel inside an
  already-bordered container, is redundant chrome. Pick one boundary.
- Inline code and small chips stay compact with no card chrome (see the
  `:not(pre) > code` rule in `src/app.css`).
- Trim meta-speak front-matter. Cut the "ask"-tic and the throat-clearing
  preambles ("In this section we will explore..."). Lead with the content.
  Cut sentences that describe what the page is about instead of being it.

## 5. Purposeful motion, fail-open, SSR- and no-JS-safe

Motion is allowed when it has a purpose (orienting a transition, confirming an
action). It is never load-bearing for legibility.

- Honor `prefers-reduced-motion: reduce`. The global rule in `src/app.css`
  collapses animations and transitions and disables smooth scroll; keep it.
- **The reveal must fail open.** Never gate content *visibility* on a class or
  state that only un-hides after hydration. A scroll-reveal that starts at
  `opacity: 0` and only animates to visible via client JS will leave content
  permanently invisible for no-JS visitors, for search and agent crawlers, and
  during the SSR paint before hydration. Spokes are static and SSR-rendered, so
  this is a real failure, not a theoretical one.
- The safe pattern: render content visible by default; let motion be additive
  progressive enhancement that *animates* already-visible content, or is
  applied only after a "JS is present" signal is set. If the class never
  applies, the reader still sees everything. Verify by loading the page with
  JavaScript disabled: all content must be present and legible.

## Quick self-check before shipping a spoke UI

- Is any glass surface unreadable without `backdrop-filter` support? Add the
  `@supports` fallback.
- Is there a tinted rectangle behind a region that adds nothing? Delete it.
- Do adjacent elements disagree on radius? Unify the scale.
- Is this a card wall or double-box? Flatten to `<dl>` or plain hierarchy.
- Turn JavaScript off: is all content still visible? If not, the reveal is
  gating visibility. Fix it to fail open.
- Turn on reduced-motion: does anything still animate or blur? Gate it.
