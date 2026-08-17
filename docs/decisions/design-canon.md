# ADR: house design canon for site.scaffold spokes

- **Status:** Accepted
- **Date:** 2026-07-05
- **Linear:** TIN-2544 (house design canon)
- **Relates to:** AGENTS.md "Theme & Skeleton" section, `src/app.css`,
  [`docs/design-direction.md`](../design-direction.md)

## Context

Spokes spawned from `site.scaffold` share a Skeleton 4 theme and the house
`src/app.css`, but each spoke's landing page and per-site theme are hand
customized after spawn. Without a written craft standard, customizing agents
tend to reintroduce the same generated-looking artifacts: opaque
semi-transparent panels that read as washed-out rather than as glass; tinted
rectangles stacked behind regions that were already legible; mismatched
border-radius between adjacent elements; walls of identical cards (often
double-boxed inside accordions); and scroll-reveal motion that gates content
visibility on client hydration, which breaks the static, SSR-rendered, no-JS,
and crawler paths that every spoke depends on.

The house theme in `src/app.css` already encodes the right instincts (featured
glass on `.saturn-nav` with a `@supports` fallback, reduced-motion handling, no
card chrome on inline code). What was missing is a durable, spoke-facing
statement of the rules so that customization does not silently undo them. This
canon was proven on a production spoke before being generalized here.

## Decision

Adopt five craft rules as house canon. They are additive guidance, not a lint
gate, and they do not change any existing default.

1. **Glass is a featured effect, never a default opaque panel.** Translucency
   is a deliberate treatment on a small number of earned surfaces, backed by
   real `backdrop-filter` with a `@supports` solid fallback and a reduced-motion
   opt-out.

2. **Background fill is a smell; intentional bleeds are craft.** A background
   region is either not separated (delineated by type, space, and rhythm) or a
   real, intentional full-bleed shape or complementary bleed done with UX and UI
   intent. Redundant tinted panels wrapped around already-legible regions are
   the smell. Delineating an individual element remains fine.

3. **Zero border-radius homogeneity.** Radius is a deliberate scale applied by
   role, never a mismatched mix of rounded and sharp in the same cluster. This
   also guards against the Tailwind-v4 `@source` scar in `src/app.css`, where an
   unseen `rounded` utility compiles to `0`.

4. **Card-reduction and de-smell discipline.** No card walls; prefer `<dl>` /
   `<dt>` / `<dd>` or plain typographic hierarchy over boxing every item; never
   double-box (card inside accordion, panel inside panel); reduce meta-speak
   front-matter and the "ask"-tic preambles.

5. **Purposeful motion, fail-open, SSR- and no-JS-safe.** Motion honors
   `prefers-reduced-motion` and is never load-bearing for legibility. The reveal
   pattern must fail open: content is visible by default and motion is additive
   enhancement, never a visibility gate that only un-hides after hydration.

The practical how-to lives in [`docs/design-direction.md`](../design-direction.md).
AGENTS.md points customizing agents at it from the "Theme & Skeleton" section.

## Why not the alternatives

- **A lint rule or CI gate.** Rejected for now: these rules are judgment calls
  (when a bleed is intentional, when a card is earned) that resist mechanical
  checking without high false-positive rates. Canon plus review is the right
  altitude. A future, narrow gate (for example, the fail-open reveal check) can
  be added if a spoke regresses, without reopening this decision.
- **Bake the rules only into the theme CSS.** Rejected as insufficient: the
  theme cannot stop a customizing agent from adding a card wall or an opaque
  glass panel on a new route. The rules need to be readable, not just encoded.
- **Leave it undocumented as tribal knowledge.** Rejected: the whole point of a
  hub template is that craft standards propagate to every spoke without a human
  re-explaining them each spawn.

## Consequences

- Customizing agents get a short, checkable standard for spoke UI, and the
  existing `src/app.css` treatments now have a documented rationale rather than
  looking like removable decoration.
- No breaking change and no default flips: existing spokes remain conformant
  because the house theme already follows the canon.
- Per-site brand specifics (palette, imagery, voice, copy) stay out of scope
  here; they live in the per-site theme and landing page. This ADR governs
  craft, not brand.
