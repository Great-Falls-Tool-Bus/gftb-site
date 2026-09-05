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

Five required keys, one optional, enforced by
`src/lib/public-log-schema.ts`:

```yaml
---
date: '2026-08-20' # YYYY-MM-DD
title: 'A real title'
summary: 'One useful sentence, at least 12 characters.'
tags:
  - website
published: false # see below
updated: '2026-08-21' # optional; cannot predate date
---
```

No other keys are allowed. The schema throws on anything else.

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

- One `.svx` file per entry (or a small batch of related entries), each
  carrying real facts pulled from merged work: program-board receipts, PR
  numbers, commit SHAs, ticket numbers. Never invented details.
- `published: false` on every entry, no exceptions.
- A short `<!-- TODO(jess): ... -->` comment at the top of the body,
  matching the existing placeholder pattern in
  `src/content/log/2026-08-16-public-front-door.svx`, so it's obvious at a
  glance that the body is a draft awaiting the operator's own words.
- `just check` and `just build` both green, including the leak-scan pass
  that runs over every draft in the tree, published or not (drafts are
  still build input and are never a place to stash anything sensitive).
- A normal PR the operator reviews and merges like any other change. No
  auto-merge, no agent merge authority over content PRs.

## Home goals, help asks, and member benefits

The home page's "Near-term goals" row renders from `src/content/goals/*.md`,
one file per row, through `src/lib/generated/goals-manifest.ts`
(`just goals-manifest-build`, drift-checked by `just goals-manifest-check`
inside `just check`). Frontmatter keys: `kind` (`goal`, `help`, or `benefit`),
`order`, `title`, `published`, and optionally `window` (plain-English timing),
`cta_label` + `cta_href` (travel together), and `source` (internal provenance,
read at build time and never emitted). The body is one or two plain sentences.
Unpublished entries never reach the manifest, and their text joins the
build-output leak denylist like draft log entries. Operator ruling 2026-08-31:
these rows are operator-authored and may carry penciled-in dates.
