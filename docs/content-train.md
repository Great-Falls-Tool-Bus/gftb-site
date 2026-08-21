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

`just log-manifest-check` (wired into `just check`) regenerates the
manifest and diffs it against the committed copy, and it is deliberately
asymmetric: a new draft that never got a manifest entry is safe (there is
nothing for it to leak), but a manifest that still lists an entry after it
flips back to `published: false` fails the check loudly, because that is
the direction that would actually put a draft in front of a visitor.

As a second, independent net over the real built bytes, `scripts/
check-build-output.mjs` folds every `published: false` entry's title,
summary, and a distinctive opening body phrase (`distinctiveDraftLiterals`
in `scripts/lib/log-content.mjs`) into the leak-scan denylist on every
build, so `just build` and `just leak-scan-stamped` prove — not just
assume — that no draft's content shipped.

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
