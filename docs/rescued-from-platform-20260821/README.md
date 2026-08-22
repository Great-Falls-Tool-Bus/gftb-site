# Rescued content from the platform repo (2026-08-21)

**Status: awaiting operator wording. Nothing in this directory is published.**

The platform repository (`Great-Falls-Tool-Bus/greatfallstoolbus.org`) is
deleting its 15 legacy public-marketing route families in a companion PR
(ratification: operator interview 2026-08-21, session register L72, Q3-REDO —
delete the legacy tree, with a rescue pass into `gftb-site` staged first).
This directory is that rescue pass: the prose and data from those routes that
is worth keeping, pulled out before the platform PR merges, redacted to the
current public-naming-consent rules, and staged here for the operator to turn
into real pages or `.svx` log entries on this site.

None of this is wired into any route or build output. It is inert Markdown
(and one image) under `docs/`, outside `src/content/` and `src/routes/`, so it
is not leak-scanned as published content and does not affect `just build`.

## Disposition per legacy family

| Family | Disposition | Why |
|---|---|---|
| `/` marketing body | ALREADY-REBUILT | This site's own `src/routes/+page.svelte` already carries the ratified spec §3 page order with its own `TODO(jess)` restoration slots (goals, needs, headline, status, next-session — see restoration PR-5 addenda B1.1–B1.4). Not duplicated here. |
| mission | RESCUED-AS-DRAFT | `mission.md`. Clean mission-statement prose, no consent issues; this site has no `/mission` route yet. |
| tools | RESCUED-AS-DRAFT | `tools-inventory.md`. The real tool-inventory data (18 items, sewing/welding/network) plus the borrow-flow copy — the actual asset, not the page chrome. |
| cells | RESCUED-AS-DRAFT | `cells.md`. The "kit + captain" concept and the three cell names. No captain names are rescued below keyholder scope (see redactions). |
| cell-sheets | NOT-WORTH-RESCUING | Purely a printable/derived view of the same tools+cells data captured in `tools-inventory.md` / `cells.md`; no unique prose. |
| wants | RESCUED-AS-DRAFT | `wants.md`. Tool-gap subset overlaps `tools-inventory.md`; the "hands and skills" asks (bus setup help, graphic designer, site reviewers) are new and clean. |
| donate | RESCUED-AS-DRAFT | `donate.md`. Donation criteria and give-vs-lend framing; clean, generic. |
| safety | RESCUED-AS-DRAFT | `safety.md`. Ground rules + code of conduct; substantive and clean, but explicitly **not operator-ratified** in the source (`OPERATOR-CONFIRM` markers) — preserved as such here. |
| bibliography | RESCUED-AS-DRAFT | `bibliography.md`. External citations of already-published works only (author/title/publisher, no relationship or affiliation claim) — fits the naming-consent.md bibliography exception. High value, low risk. |
| shout-outs | RESCUED-AS-DRAFT, heavily redacted | `shout-outs.md`. See "Redactions" below — most of the source page could not be rescued as-is. |
| keyholders | RESCUED-AS-DRAFT, flagged for an operator call | `keyholders-mail-guide.md`. Mechanically clean (no PII), but it is a private-list onboarding runbook, not obviously "public information site" content — operator should decide whether it belongs here or in the private ops docs instead. |
| stewards | NOT-WORTH-RESCUING | The "steward" vocabulary is retired (absolute consent rule for this task). The source page's roster was already empty (`Do NOT invent names here`), so nothing concrete is lost; the underlying role concept (someone coordinates, one person per cell who knows the kit, someone owns safety) may be worth re-deriving under new, non-"steward" vocabulary as a future operator decision — not drafted here, to avoid inventing copy under a retired term. |
| contact | ALREADY-REBUILT, prose supplement offered | This site's `/contact` already has its own form, keyholders/discuss addresses, and QR card. `contact-supplement.md` offers the platform's "How access works" 4-step flow and "find the bus" privacy-by-design framing, which are not yet in this site's contact page, as optional additional copy. |
| discuss | ALREADY-REBUILT | PR #35 already added the public HyperKitty archive link to this site's home and contact pages. Nothing further to rescue. |
| agent | NOT-WORTH-RESCUING | The platform `/agent` route indexes *that repo's own* AGENTS.md/CI-SCHEMA.md/Justfile — repo-specific developer/agent-contract documentation. Copying it here would describe the wrong repository. |

## Other rescued asset

- `hand-tools-plate-1922.jpg` — a public-domain 1922 engraving of hand tools
  (Louis M. Roehl, *Manual Training for the Rural Schools*; Wikimedia Commons,
  no known copyright restrictions), used on the platform's `/mission` page.
  Not yet used by any page here. If the operator wants it, provenance to carry
  into `docs/attribution.md` and `NOTICE` is: title "Plate of woodworking hand
  tools"; source
  <https://commons.wikimedia.org/wiki/File:Manual_training_for_the_rural_schools;_a_group_of_farm_and_farm_home_woodworking_problems_(1922)_(14781178044).jpg>;
  license "Public domain (no known copyright restrictions)"; verified via the
  Wikimedia Commons API on 2026-07-04. (`great-falls-lewiston-1930s.jpg`, the
  platform's other credited photo, is already in this site's `static/photos/`
  and `docs/attribution.md` — not duplicated here.)

## Redactions made before this first commit

Per the absolute public-naming-consent rules for this task (both repos are
public; a name in any commit, even a draft, is a disclosure), the following
were redacted or excluded entirely from the source `shout-outs` page before
anything was staged — no redact-after-commit step was needed because the
removal happened before the first write:

1. **The bus host's property as the bus's home base.** The source page named
   "J." (his consented public form) as an Alderman who "hosts the bus on his
   property," with "the home base a keyholder shares with you on request."
   `steering/naming-consent.md` (meta repo) grants "J." only an initial-only
   attribution row; it explicitly does **not** extend to publishing an
   address, schedule, or live location. `shout-outs.md` keeps the "J." /
   Alderman / hosts-the-bus attribution but drops the "home base" /
   location-sharing sentence.
2. **The entire "Friends of the bus" section**: The Portland makerspace
   community, Ithaca Generator, and Artisan's Asylum. `naming-consent.md`
   states in terms: *"The Portland makerspace community, Ithaca Generator,
   Artisan's Asylum, Cornell CALS Landscape Architecture makerspace, and
   Plymouth State D&M Makerspace have no current public-consent row. Do not
   include them in public shout-outs, history, biography, or bibliography
   without new consent."* Excluded wholesale, not just trimmed.
3. **The "About the shop chops behind the site" biography paragraph**, which
   named Cornell CALS, Ithaca Generator, and Plymouth State's D&M Makerspace
   as Jess's affiliations. Same rule as (2) — "biography" is one of the
   explicitly banned uses for these five organizations. Jess Sullivan's own
   name and role ("Webmaster & mail admin") are fully consented and kept;
   the specific-affiliation biography prose is not.
4. Ripley ("Founding supporter") and Alex ("Founder") entries are kept
   verbatim — both have a current public-consent row for exactly this scope.

No other family's source content named anyone beyond Jess Sullivan / Alex /
Ripley / "J." within their consented scopes, published a bare personal email,
a dollar amount, a donor name, a lease specific, or "steward" vocabulary
(`stewards` itself is excluded wholesale, see above), or implied the bus is
anything but permanently parked (verified: no motion/travel copy in any of
the 15 families read for this rescue).

## What to do with this

Operator: turn any of these into a real page (or a `published: false` →
`published: true` `.svx` log entry once written in your own words) whenever
you're ready. Wording is yours — this is the raw material, not a draft ready
to publish; the `just leak-scan` / naming-consent gates apply the moment
anything here moves into `src/`.
