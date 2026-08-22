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
| bibliography | RESCUED-AS-DRAFT, two entries edited | `bibliography.md`. External citations of already-published works only (author/title/publisher, no relationship or affiliation claim). Two entries originally also carried an organizational byline for an organization with no current public-consent row; a more specific restriction in `steering/naming-consent.md` overrides the general bibliography exception for that organization, so the byline was dropped from both (round 2, see file header). |
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

## Redactions

A commit to a public repository is publication, draft directory or not — so
this section describes what was removed **by category only**. No third-party
name, organization name, or restated claim is reproduced here; anyone who
needs the specifics has access to the private `steering/naming-consent.md`
authority (meta repo) that governs this.

**Round 1 (before the first commit):**

1. A location/relationship detail belonging to a consented subject, beyond
   the scope their consent row actually grants (initial only — not an
   address, office, schedule, or live location).
2. An entire section crediting several third-party organizations with no
   current public-consent row.
3. A biography paragraph restating those same organizations as personal
   affiliations.
4. The two consented founder/supporter entries and the consented
   webmaster/mail-admin entry are kept verbatim — each has a current
   public-consent row covering exactly that scope.

**Round 2 (adversarial review of platform PR #193, after the first commit):**

5. `shout-outs.md`'s bus-host entry still carried an office, a municipality,
   and a property-hosting fact together after round 1 — round 1 had only
   trimmed one clause, not the underlying facts. Deducible in combination:
   a public office-holder roster resolves the office+municipality pair to a
   legal identity, and identity plus "hosts the bus" narrows the bus's
   physical location to that person's property. Reduced to the consented
   initial plus the generic role his own consent row uses. The matching
   municipality reference in `contact-supplement.md` was removed for the
   same reason.
6. `safety.md` had re-imported a named-precedent attribution that the
   platform repository's own history already redacted (a real commit on that
   repo removed exactly this attribution). Fixed to match the platform's own
   redacted wording, not the original.
7. Two `bibliography.md` entries carried an organizational byline for one of
   the round-1 organizations. The general bibliography exception in
   `steering/naming-consent.md` does not apply where a more specific
   restriction exists for that organization — dropped the byline, kept the
   title/author/date citation.

No other family's source content named anyone beyond the consented subjects
within their consented scopes, published a bare personal email, a dollar
amount (except third-party-published-source citations in `bibliography.md`,
judged acceptable — see that file), a donor name, a lease specific, or
"steward" vocabulary (`stewards` itself is excluded wholesale). One
imprecision in an earlier version of this file: an absolute "no motion/travel
copy" claim was true of every family's substance but glossed two incidental
"on wheels" / "even on wheels" phrases describing the vehicle, not asserting
travel — noted, not treated as a violation, but this file no longer asserts
absolutes it hasn't re-checked after each edit.

## Before using any of this

Nothing here has been checked for present-tense availability language.
Several files carry copy inherited from a marketing site — "the tool is
yours to take," "every request gets a human answer" — written when intake
was live. It is not, right now. The standing rule for dated public copy is
that it may say something is **not yet** available; it must never say it
**is**. Check each file against current status before publishing, not just
against naming consent.

## What to do with this

Operator: turn any of these into a real page (or a `published: false` →
`published: true` `.svx` log entry once written in your own words) whenever
you're ready. Wording is yours — this is the raw material, not a draft ready
to publish; the `just leak-scan` / naming-consent gates apply the moment
anything here moves into `src/`. Note that `just leak-scan`'s structural
rules (hosts, mailboxes, secret shapes) cannot substantiate a naming-consent
claim by themselves — a green gate run is not consent evidence for prose
content; the redactions above were done by reading the actual text, and any
future edit to these files needs the same.
