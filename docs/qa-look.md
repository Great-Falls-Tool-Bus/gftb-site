# qa-look (reserved name)

Tombstone, 2026-09-03. This file replaces `docs/qa-packet.md`, which described
a CI job and toolchain that were excised the same day.

Operator ruling (2026-09-03, verbatim):

> the current qa-look is a completely hallucinated implementation that is NOT
> at all what qa-look means. excise that false, made up, incorrect qa-look
> phase. PullRequestEnvironment/v1 v4 is the only correct lane; a job and code
> literally called QA look should be the canonical development flow for
> LOOKing at a QA dev environment.

## Why the job was misnamed

The excised `qa-look` job (`.github/workflows/ci.yml`), the `just qa-packet` /
`qa-packet-diff` recipes, `scripts/qa-packet.mjs`, `scripts/qa-packet-diff.mjs`,
`scripts/lib/qa-packet-paths.*`, and `playwright.qa-packet.config.ts` were an
evidence-packet capture pipeline: a static screenshot matrix plus a receipt,
uploaded as a CI artifact. That is not a LOOK. No routable QA environment ever
existed in that flow — nothing an operator could open, drive, and look at.
Calling it `qa-look` was a hallucinated reading of the name.

## What the name is reserved for

`qa-look` is reserved for the PullRequestEnvironment/v1 consumer flow: a
routable, tailnet-only, reapable, exact-head QA environment per pull request,
plus the operator LOOK against it. Estate contract: "the pr-N lane IS the QA
evidence." Until that flow lands here, nothing in this repository may reuse
the name.

The `validate` action in `.github/lanes.json` now selects
`//:ci_validation_suite`, including `//:browser_smoke_test`. That registered
test runs five Chromium acceptance specs from `e2e/` over its declared static
build, using GF's provisioned browser inside the remote action. It installs no
browser and uses no ambient preview. The former local preview launcher remains
removed.

This source registration is not proof that the action has executed, and a
passing browser test is not a deployed PR environment or human LOOK. The
owner controller must still create the routable exact-head environment and
reap it on merge, close or expiry; the operator must LOOK at that served head
before merge. No local server, screenshot packet or post-merge inspection
substitutes for that lifecycle.
