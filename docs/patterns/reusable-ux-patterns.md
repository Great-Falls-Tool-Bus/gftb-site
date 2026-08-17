# Reusable UX primitives (opt-in)

These are small, brand-neutral building blocks a spoke MAY import. None is wired
into the default layout or any page, so they add zero weight until a spoke uses
them. They were distilled from the `greatfallstoolbus.org` spoke and kept only
where the pattern is genuinely house-general; the branded skin around each stayed
in that spoke. Each entry below records the upstream-vs-spoke call and why.

## Reduced-motion helper - UPSTREAMED

`src/lib/runes/reduced-motion.svelte.ts`

- `createReducedMotion()` - a reactive `prefers-reduced-motion` reader wrapping
  `MediaQuery` from `svelte/reactivity`, matching the `scroll-state` rune shape.
- `prefersReducedMotion()` - a one-shot, SSR-safe snapshot for use inside actions
  or event handlers.

**Why upstream:** every spoke that animates needs one honest source of truth for
this preference, and the ad hoc `new MediaQuery('(prefers-reduced-motion: reduce)')`
already appears in more than one place. It is pure platform behavior with no brand
in it. SSR fails open (reports "not reduced") so the first client frame matches a
motion-capable render and then reconciles.

## `reveal` motion action - UPSTREAMED

`src/lib/actions/reveal.ts`

A scroll-into-view action that **fails open**: the element ships visible and the
action only opts into a hidden→shown transition when it can prove it can show the
element again (client-side, `IntersectionObserver` present, motion not reduced).
Any failing check leaves the element in its natural visible state, so a broken
observer, an old browser, or a reduced-motion setting can never strand content
hidden. The action toggles a single `data-reveal` attribute; the transition LOOK
is CSS the spoke owns.

**Why upstream:** the fail-open discipline is the reusable part and the easy thing
to get wrong (the common bug is JS that hides content then never reveals it). The
mechanism is brand-neutral; the motion styling is left to the theme layer, so no
spoke inherits another spoke's animation taste.

Example CSS a spoke supplies:

```css
[data-reveal='hidden'] {
	opacity: 0;
	transform: translateY(1rem);
}
[data-reveal] {
	transition:
		opacity 0.5s ease,
		transform 0.5s ease;
}
```

## `ExternalLink` outbound convention - UPSTREAMED

`src/lib/components/ExternalLink.svelte`

An anchor that leaves the site renders with `rel="external noopener noreferrer"`,
`target="_blank"`, a trailing `↗` affix, and a visually-hidden "(opens in new
tab)" hint. The `↗` is decorative (aria-hidden); the screen-reader text carries
the signal.

**Why upstream:** outbound-link safety (`noopener`) and a consistent affix are a
house convention, and the scaffold already handles this ad hoc in a couple of
places (a `Card` `external` prop, `rel="noopener"` on the source-link affordance).
One component removes that drift. The `↗` glyph is a widely-understood convention,
not a brand mark.

**Convention:** prefer `ExternalLink` for any user-facing off-site anchor. Bare
`<a target="_blank">` without `rel="noopener"` is a `window.opener` footgun and
should be treated as a review smell.

## Deterministic name-tint helper - UPSTREAMED; Avatar - UPSTREAMED minimal, sharp skin STAYS in spoke

`src/lib/util/name-tint.ts`, `src/lib/components/Avatar.svelte`

- `nameTint(name)` - a pure FNV-1a hash mapping any string to a STABLE hue plus a
  theme-safe `hsl` background/foreground pair. Same input always yields the same
  color, so a roster gets distinct, consistent tiles with no stored colors and no
  hydration flicker. Case- and whitespace-insensitive. Covered by
  `name-tint.test.ts`.
- `initials(name)` - first+last initial fallback.
- `Avatar.svelte` - a minimal, brand-neutral tile that consumes the helper (image
  when `src` is given, tinted initials otherwise).

**Why the split:** the tint HELPER is pure and obviously reusable, so it is
upstreamed as-is. The Avatar COMPONENT is upstreamed but kept deliberately
un-opinionated: `shape` defaults to `'rounded'`, the safe cross-spoke default. The
**sharp / hard-cornered tile look** that reads well against `greatfallstoolbus.org`'s
planet-ring aesthetic is a per-spoke SKIN choice, not a house default, so it stays
in that spoke (pass `shape="square"` to reproduce it). Baking one spoke's corner
language into the scaffold would push an aesthetic onto every future spoke for no
reason.

## Responsive `<picture>` pipeline consumers - UPSTREAMED

`src/lib/components/Picture.svelte`, `src/lib/responsive-image.ts`

The scaffold already shipped the image PRODUCER (`scripts/optimize-images.js`:
sharp + svgo -> webp/avif derivatives + a manifest) but no CONSUMER, so a spoke
had to hand-roll `<picture>` markup to use it. These two primitives close that
gap, brand-free:

- `responsiveSources(src)` - a thin srcset builder over the build-generated
  `static/image-manifest.json`. It only reads derivatives the optimizer already
  emitted; it never invents sizes or paths. Guards baked in: a
  `MIN_RESPONSIVE_WIDTH` downgrade guard (an image whose largest derivative is
  still small opts OUT of srcset so hi-DPI displays are never handed a tinier
  candidate than the original), a retina cap that appends the format-matching
  webp original at `xlarge*2` only when derivatives top out at the xlarge bucket,
  and graceful degrade when the manifest has no entry (the raw `src` still works).
  `intrinsicSize(src)` returns the manifest's recorded pixel dimensions.
- `Picture.svelte` - a manifest-driven `<picture>` that renders typed AVIF/WebP
  `<source>` sets and always falls back to a plain `<img>`. When the manifest
  knows the intrinsic size it sets `width`/`height` + an explicit `aspect-ratio`
  to reserve the layout box and prevent cumulative layout shift (CLS). Generic
  API only: `src`, `alt`, `sizes`, `loading`, `decoding`, and a `class`
  passthrough. Covered by `responsive-image.test.ts`.

Producer upgrades that landed with the consumers: the manifest now records
intrinsic `width`/`height` per raster (from sharp metadata, for CLS), and it is
written to `static/image-manifest.json` (was `src/lib/image-manifest.json`) with
a committed empty-object fallback so zero-photo builds and fresh spawns resolve
the import without ever running the optimizer.

**Why upstream:** every spoke that ships photos needs right-sized derivatives
and a CLS-safe box, and the easy things to get wrong are exactly the ones
encoded here (a tiny srcset silently downgrading a sharp original; a missing
manifest entry throwing instead of degrading; an unreserved box shifting layout
on load). The mechanism is pure platform behavior with no brand in it; the
optimizer emits generic named-size buckets and the component carries no copy,
imagery, or aesthetic. A spoke opts in per `<img>` by swapping in `<Picture>`;
nothing is wired into the default layout, so this adds zero weight until used.

## View/edit-source subsystem - UPSTREAMED

`scripts/build-source-map.mjs`, `src/lib/components/SourceLink.svelte`,
`src/lib/components/PageHeader.svelte`, `src/lib/generated/source-map.json`

The git-onboarding affordance: every substantive page links to its own source so
a reader can open "View source" or propose an edit through GitHub's web editor.
Three parts:

- `build-source-map.mjs` walks `src/routes/**/+page.svelte` and emits a
  deterministic `source-map.json` (sorted keys, tab-indented) mapping each
  SvelteKit route id to its repo-relative source path, plus the repo URL and
  branch. It hardcodes NO org/repo string: the repo URL derives from
  `tinyland.repo.json` `repo.github` (with `package.json` `repository.url` as the
  fallback) and the branch from `repo.defaultBranch` (default `main`).
- `SourceLink.svelte` reads the generated map and renders the "Edit this page /
  View source" pair for the current route, degrading to nothing when the route
  has no entry.
- `PageHeader.svelte` is the DRY eyebrow -> h1 -> lead block, and it auto-renders
  `SourceLink` from the route it reads off `page`. Because the affordance is wired
  into the shared header (never per-page), a new page gets it for free and cannot
  silently lack provenance.

Drift-gated: `just source-map-build` regenerates the map and `just source-map-check`
(appended to `just check`) runs the generator then `git diff --exit-code` on the
generated file, so a new or moved route fails CI until the committed map is
rebuilt. `scripts/rebrand.sh` regenerates the map after it rewrites
`tinyland.repo.json`, so a fresh spawn's committed map carries the spawn's own
repo URL instead of the hub's and stays green on the first `just check`.

**Why upstream:** the whole point is architectural zero — provenance is derived
from the routes tree and the repo manifest, not hand-maintained per page, so it is
correct for every spoke the moment it spawns with no per-repo wiring. The
generator and both components are brand-neutral; a spoke supplies only its own
route content and (optionally) a `@lucide/svelte` icon per `PageHeader`.

**Not ported (subsumed):** the GFTB `DetailsNeeded` component and the `$lib/repo.ts`
`editUrl` helper. Both were spoke-local ways to reach the same "edit on GitHub"
destination; the derived source map subsumes them, so carrying them forward would
just be two more places to drift.

## Mobile drawer stacking fix + semantic z-index scale - UPSTREAMED

`src/routes/+layout.svelte`, `src/lib/components/BindableDrawer.svelte`,
`src/lib/components/ThemeSwitcher.svelte`, `src/app.css`, `e2e/mobile-nav.spec.ts`

Distilled from `greatfallstoolbus.org` PR #142, where the mobile nav drawer was
hidden behind page content at the iPhone SE breakpoint (375px). Three parts:

- **Portal the drawer.** Skeleton 4 dialogs do NOT auto-portal, and the glass
  AppBar's `backdrop-filter` makes it the containing block for fixed-position
  descendants (CSS Filter Effects 2). A `Dialog.Backdrop`/`Dialog.Positioner`
  rendered inline inside `AppBar.Trail` therefore resolves its `fixed inset-*`
  against the ~52px AppBar box, not the viewport - the open drawer collapses
  to a strip pinned in the header, behind content, untappable. Wrapping the
  backdrop + positioner in Skeleton's `<Portal>` mounts them at
  `document.body`, where `fixed` means the viewport again. Both the layout's
  inline drawer and the reusable `BindableDrawer` teach the portaled form.
- **Semantic z-index scale.** `:root` tokens in `app.css`
  (`--z-dropdown: 30` < `--z-sticky: 40` < `--z-modal-backdrop: 50` <
  `--z-modal: 60` < `--z-toast: 70` < `--z-tooltip: 80`), consumed in markup
  through the Tailwind v4 var shorthand (`z-(--z-sticky)`). One ladder, never
  an arbitrary 999. Edge encoded in `ThemeSwitcher`: a portaled popover that
  can be triggered from INSIDE a modal must ride a tier above `--z-modal`.
- **Unlayered `position` footgun.** `.saturn-nav { position: relative }` was
  unlayered CSS, so it out-cascaded the layered Tailwind `sticky top-0`
  utility and the glass header never actually stuck. The rule now carries a
  do-not-set-`position`-here comment; `sticky` provides the positioned
  ancestor the `::after` halo needs.

Regression-guarded by `e2e/mobile-nav.spec.ts` (375px): asserts the open
drawer is not a DOM descendant of the AppBar, that backdrop/drawer geometry
pins to the viewport, and that a drawer item's center actually receives the
tap and navigates.

**Why upstream:** every glass-AppBar spoke spawned from this scaffold inherits
the exact trap (the containing-block rule fires on ANY ancestor filter,
backdrop-filter, or transform), and the failure is invisible on desktop where
the drawer trigger is hidden. The portal discipline, the z ladder, and the
cascade comment are pure platform behavior with no brand in them; the drawer's
look stays whatever the spoke themes it to be.

## Not upstreamed (stayed spoke-specific)

- The `greatfallstoolbus.org` **sharp-tile avatar skin**, planet-ring chrome, and
  any tool-library / steward copy. These are brand, not primitives.
- Any content, imagery, mail addresses, or org names from a spoke. Primitives
  travel; brand does not.
- The GFTB **icon choices and header copy** for `PageHeader` (which lucide glyph a
  page shows, the lead wording). The scaffold ships `PageHeader` as props and
  snippets only; the icon and copy are a per-spoke decision, not a house default.

## Agent contract note: `.agents` consolidation is the standard

Confirmed house standard (unchanged by this document, recorded here for spokes):

- The **root `AGENTS.md`** is the single agent-agnostic operating contract. It is
  the truth source every coding agent reads first, regardless of vendor.
- **`CLAUDE.md`** is a thin overlay that points at `AGENTS.md`; it does not restate
  or outrank it.
- Canonical skills live under **`.agents/skills/<name>/SKILL.md>`**, with
  per-tool adapters (for example `.agents/skills/<name>/agents/openai.yaml`) beside
  them. Project skill copies under `.claude/skills/*` mirror the canonical
  `.agents/skills/*`.

The takeaway: keep the agent-facing contract agent-agnostic in `AGENTS.md` plus
`.agents/`, and let vendor-specific files be thin adapters over it.
