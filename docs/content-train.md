# The content train

This is the convention for `src/content/log/*.svx`, the public log at `/log`.

## One entry per receipt-worthy event

A log entry exists because something real and public happened: a site
change shipped, a feature launched, a piece of project work reached a real
milestone. Not every merged PR gets one. Not every internal decision gets
one. If it isn't something an outside reader would care about, it doesn't
belong here.

## Voice

Write like [jesssullivan.github.io](https://jesssullivan.github.io): short,
first person, concrete. Say what happened and what it means in plain words.
No AI-speak, no meta-language about the writing process itself, no
em-dashes standing in for real punctuation. If a sentence reads like a
summary a machine would write about its own work, cut it and say the thing
directly instead.

Money and contribution copy stays recipient-neutral: describe what happens
(cash, check, Stripe) without implying tax-deductibility or nonprofit
status that hasn't been decided.

## Availability claims: under-claim only, always dated

HARD RULE, refined in PR #36's round-3 review after four recurrences of the
same pattern (F2 in PR #33; B4 and EDIT-1 in PR #36). The axis is direction
plus dating, not which system the claim is about:

- A dated entry MAY state that something is **not yet** available ("not
  live yet", "still gated", "waiting on wording"). Under-claiming ages into
  a true historical note.
- A dated entry may NEVER state that something **is** available ("the
  public website you're reading this on", "the membership system is live").
  Over-claiming ages into a false invitation — the worst case being copy
  that invites applications into a system that cannot receive them.

A draft can sit in the tree for days before the operator rewrites and
merges it, and the apex's public/gated state can flip in that window
(access-gated for a review round, opened, re-gated again). Any sentence
that asserts "the public website you're reading this on right now" or
similar is a claim about the world at merge time, made at draft time. It
will eventually be wrong even if it happens to be right today. Say what
was built and shipped in the codebase sense ("Built and deployed: the new
site.") and leave live/gated status out of draft prose entirely; the
operator adds a status claim only when writing in their own words, at the
moment they know it's still true.

## The frontmatter contract

Five required keys, with optional `updated` and the flat featured-image group,
are enforced by `src/lib/public-log-schema.ts`:

```yaml
---
date: '2026-08-20'
title: 'A real title'
summary: 'One useful sentence, at least 12 characters.'
tags:
  - website
published: false
updated: '2026-08-21'
---
```

Dates are quoted `YYYY-MM-DD` strings. The filename must be
`YYYY-MM-DD-lowercase-slug.svx`, with the same date as the frontmatter. Every
entry, including a draft, needs its own date; duplicate dates or slugs fail
validation. A title needs at least three characters, a summary at least twelve,
and `tags` must be a nonempty list of nonempty strings. Omit `updated` until
needed; when present, it cannot predate `date`.

The optional image fields are `image`, `image_alt`, `image_caption`, and
`image_aspect`. `image` and useful alt text travel together. A caption or aspect
requires that pair. Use a site-relative image path such as
`/photos/log/a-shelf-1280.jpg`, with a `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`,
or `.svg` extension; external URLs and traversal paths are refused.
`image_caption`, if present, must be nonempty. `image_aspect` is a quoted
fraction such as `'3/2'`, with each positive integer at most three digits.
Alt text and captions follow the existing copy and naming-consent rules.

For an unpublished entry, `image` may name the asset's future `static/` path
while its source waits under `src/content/log/_assets-pending/<slug>/`.
Before publication, complete the image and attribution review in
[the attribution guide](attribution.md) and move the approved asset into its
declared `static/` location. A published entry with a missing asset is refused.

No other frontmatter keys are allowed. Use top-level scalars and the simple tag
list shown above; the parser does not support nested objects or inline YAML
comments. Put editing instructions in the body or this guide.

## Start from a template

- [Plain log draft](../src/content/templates/public-log.svx)
- [Log draft with an image](../src/content/templates/public-log-with-image.svx)

Open either literal SVX file in your editor and save a copy under
`src/content/log/` with the dated filename described above. Replace the example
date, title, summary, tags, and body; replace the image fields when used, and
omit optional fields you do not need. Keep `published: false` and the
`TODO(jess)` marker while the draft awaits review. The templates are ordinary
SVX examples, with no editor-specific variables or configuration.

The originals live outside the log directory and never become log entries.
Their actual bytes are checked through the shared frontmatter parser and
schema by the existing `//:unit_tests` target (`just test-unit` and the remote
`validate` action). A copied draft also enters the normal log, manifest, and
build-output checks. No manifest regeneration is needed for an unpublished
draft; publishing still follows the operator review below.

## `published: false`, always, from an agent

Every entry an agent drafts ships as `published: false`. That is not a
suggestion, it is enforced practice going back to addendum B1.2, and the
exclusion happens at BUILD time, not by filtering at render time.

`scripts/build-log-manifest.mjs` reads every `.svx` file straight off disk
(`scripts/lib/log-content.mjs`, plain `node:fs`, no Vite involved) and
writes `src/lib/generated/log-manifest.ts`, a checked-in file that lists
ONLY the entries with `published: true`, each as a literal
`import('.../<slug>.svx')`. `src/lib/public-logs.ts` imports that
generated file and nothing else content-shaped, so an unpublished draft's
title, summary, or body is never an import statement anywhere the client
bundle can reach. It can sit in the content tree, reviewed and merged,
without ever being live.

`just log-manifest-check` (wired into `just check`) runs the generator read-only
inside its registered Bazel test and compares it to the committed copy. It is
deliberately
asymmetric: a new draft that never got a manifest entry is safe (there is
nothing for it to leak), but a manifest that still lists an entry after it
flips back to `published: false` fails the check loudly, because that is
the direction that would actually put a draft in front of a visitor.

As a second, independent net over the real built bytes, `scripts/
check-build-output.mjs` folds every `published: false` entry's title,
summary, and a distinctive opening body phrase (`distinctiveDraftLiterals`
in `scripts/lib/log-content.mjs`) into the leak-scan denylist on every
build, so the remote `site-build` action selected by `just build` proves — not
just assumes — that no draft's content shipped.

## The merge is the publish

The operator reads the draft, rewrites it in their own words (or replaces
it outright), and only then flips `published: true`. Once that PR merges
to `main` and the next build ships, the entry is live. There is no
separate publish step: the merge, with `published: true` already set by
the operator's own hand, is what makes an entry public. Agents open the
PR; only the operator merges it.

## What an agent PR looks like

- One `.svx` file per entry (or a small batch of related entries), with verified
  public facts. Put supporting program-board receipts, PR numbers, commit SHAs,
  and ticket references in the PR description, never in the SVX file. Drafts
  are not private mail storage; do not copy private identities or correspondence
  into them. Never invent details.
- `published: false` on every entry, no exceptions.
- A short `<!-- TODO(jess): ... -->` comment at the top of the body,
  matching the templates above, so it's obvious at a
  glance that the body is a draft awaiting the operator's own words.
- `just check` and `just build` both green, including the leak-scan pass
  that runs over every draft in the tree, published or not (drafts are
  still build input and are never a place to stash anything sensitive).
- A normal PR the operator reviews and merges like any other change. No
  auto-merge, no agent merge authority over content PRs.

## Home Notes & Goals, help asks, and member benefits

The home page's "Notes & Goals" row renders from `src/content/goals/*.md`,
one file per row, through `src/lib/generated/goals-manifest.ts`
(`just goals-manifest-build`, drift-checked by `just goals-manifest-check`
inside `just check`). Frontmatter keys: `kind` (`goal`, `help`, or `benefit`),
`order`, `title`, `published`, and optionally `window` (plain-English timing),
`cta_label` + `cta_href` (travel together), `source` (internal provenance,
read at build time and never emitted), and the same optional flat image group
described above. The body is one or two plain sentences.
Unpublished entries never reach the manifest, and their text joins the
build-output leak denylist like draft log entries. Operator ruling 2026-08-31:
these rows are operator-authored and may carry penciled-in dates.

Presentation (operator rulings 2026-09-08 and 2026-09-09): the served HTML,
reduced motion, the Off detent, print and forced colours are all the same
plain, borderless grid of every row (`src/lib/components/NotesAndGoals.svelte`);
that grid is the rollback surface. Once enhanced, the rows page under the
ratified windshield wiper (`src/lib/wiper`, landed in six milestones behind
attended LOOKs: the DOM wipe, the GPU scene behind the notes, the chrome arms,
the glass, the WebGPU tier with its WebGL2 fallback, and the rails). Content
authors need no knowledge of it: a row is a row, the wiper pages whatever the
manifest publishes, a note that straddles the two blades on a wide screen is
wiped by both, the outgoing page leaves as one row ahead of the blade that
reaches it first, and the detent a visitor picks on the stalk is remembered
by their browser. Each row carries an "Edit" link to its own source file and
the section links the whole collection (`/tree/<branch>/src/content/goals`):
the SourceLink "edit this page"
exception extended to the collection, built from `source-map.json` and the
manifest's `sourcePath`, never a hardcoded repo string.
