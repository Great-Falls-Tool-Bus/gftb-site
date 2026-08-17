# Default-branch protection baseline

## Why

As of 2026-07-09, only 9 of 155 `tinyland-inc` repos carried any branch
protection at all, and this scaffold (the template every spoke spawns from)
was one of the unprotected ones. Because nothing propagates from an
unprotected template, spokes keep regenerating with silent-red, force-pushable,
deletable default branches. This file documents the minimal baseline every
load-bearing Tinyland repo should carry, and how to apply it to a spoke.

## The baseline

The template lives at [`.github/rulesets/default-branch.json`](../../.github/rulesets/default-branch.json)
and targets the repo's default branch (`~DEFAULT_BRANCH`, so it survives a
default-branch rename). It enforces five things:

- **Require a pull request before merging**, with `required_approving_review_count: 0`.
  This forces every change through a PR (so nothing lands on the default
  branch silently) without forcing a second approver: the solo operator can
  open and merge a PR without waiting on review.
- **Require signed commits.**
- **Require the stable `merge-gate` status**, with strict/up-to-date checking.
  `merge-gate` waits for the complete reusable `spoke-ci` call and the local
  substrate-boundary job.
- **Block force-pushes** to the default branch (`non_fast_forward`).
- **Block default-branch deletion** (`deletion`).

Do not require expanded matrix leaf names. Those display names include lane
data and are not a stable branch-protection API. Do not use
`ci/lane/default` as the aggregate either: on site.scaffold PR #89 it became
successful before Playwright started, and on PR #82 it remained successful
despite real failed jobs. The wrapper-level `merge-gate` is the durable
contract.

`bypass_actors` is intentionally empty: nobody, including repo admins,
bypasses force-push/deletion protection or the PR requirement. Because
required approvals is 0, this preserves the solo-operator flow while ensuring
auto-merge waits for the complete CI gate.

## Applying it to a repo

Prefer a repository **ruleset** (the modern API) over classic branch
protection. Apply the checked-in JSON directly:

```bash
gh api repos/tinyland-inc/<repo>/rulesets \
  -X POST \
  --input .github/rulesets/default-branch.json
```

Before applying, check whether the repo already has equivalent-or-stricter
protection so you don't create a redundant or conflicting rule:

```bash
gh api repos/tinyland-inc/<repo>/branches/<default-branch>/protection
gh api repos/tinyland-inc/<repo>/rulesets
```

After applying, confirm the rules are actually in force on the branch (not
just stored) via the effective-rules endpoint:

```bash
gh api repos/tinyland-inc/<repo>/rules/branches/<default-branch>
# expect: deletion, non_fast_forward, pull_request, required_signatures,
#         required_status_checks
```

If classic branch protection already blocks force-push, blocks deletion,
and requires a PR to merge, leave it as-is rather than layering a ruleset
on top. Note that `/rules/branches/*` reports ruleset-sourced rules only;
classic protection is read from the `/branches/*/protection` endpoint.

## Free-plan-private caveat: probed, not assumed

There was a standing assumption in this estate that GitHub branch
protection and rulesets are fully enforced on public repos but limited or
`422`-rejected on Free-plan private repos. That assumption was tested
empirically on 2026-07-09, per repo, rather than taken on faith:

- The `tinyland-inc` org's `plan.name` currently reports `enterprise`
  (via `gh api orgs/tinyland-inc`), not `free`.
- The ruleset above was applied via the API to **six** previously
  unprotected load-bearing repos, including one private repo
  (`site.scaffold` itself). All six calls returned `201` with
  `"enforcement":"active"`. Zero `422`s.
- Enforcement was confirmed (not just storage) via
  `GET /repos/tinyland-inc/<repo>/rules/branches/main`, which returned
  `deletion`, `non_fast_forward`, and `pull_request` as the effective rule
  set on all six, including the private repo.

So for this org, in its current plan state, rulesets are not blocked on
private repos. If a future repo (or a different org/plan context) returns
a `422` on this call, that is the signal the Free-plan-private limitation
is live for that repo. Fall back to classic branch protection
(`PUT /repos/<org>/<repo>/branches/<default-branch>/protection`) with the
same three settings, and record the fallback here.

## Load-bearing repo pass, 2026-07-09

Applied to the eleven repos judged load-bearing (the org's shared
infrastructure and template surfaces), not the ~140 non-load-bearing
spawned spokes, which are a separate follow-up batch.

| Repo | Visibility | Prior state | Action | Result |
|---|---|---|---|---|
| `bazel-registry` | public | unprotected | applied ruleset | `active`, enforcement confirmed (ruleset id 18745043) |
| `ci-templates` | public | classic protection: PR req. 0 approvals, force-push blocked, deletion blocked, no required checks | none; already meets baseline | compliant |
| `tinyland.dev` | private | classic protection: PR req. **1** approval, force-push blocked, deletion blocked, conversation resolution required | none; meets or exceeds the three core goals. Approval count is stricter than baseline and was left untouched rather than loosened | compliant (exceeds) |
| `tinyland-infra` | private | classic protection: PR req. 0 approvals, force-push blocked, deletion blocked | none; already meets baseline | compliant |
| `blahaj` | private | classic protection: PR req. 0 approvals, force-push blocked, deletion blocked, **plus 7 required status checks** (pre-existing, unrelated decision) | none; meets or exceeds baseline. Required checks left untouched (out of scope for this pass) | compliant (exceeds) |
| `tinyland-auth` | public | unprotected | applied ruleset | `active`, enforcement confirmed (ruleset id 18745044) |
| `tinyland-fingerprint` | public | unprotected | applied ruleset | `active`, enforcement confirmed (ruleset id 18745045) |
| `tinyland-invitation` | public | unprotected | applied ruleset | `active`, enforcement confirmed (ruleset id 18745046) |
| `tinyland-security` | public | unprotected | applied ruleset | `active`, enforcement confirmed (ruleset id 18745047) |
| `site.scaffold` | private | unprotected | applied ruleset | `active`, enforcement confirmed (ruleset id 18745048); private repo, no `422` |
| `GloriousFlywheel` | public | ruleset `Protect main` (id 14296368) already present, same shape as this baseline (deletion, non_fast_forward, PR req. 0 approvals), plus classic protection with code-owner review and conversation resolution required | none; already meets baseline | compliant |

No repo returned a `422` or any other error in this pass. Every load-bearing
repo now has at least the three-rule baseline in force, either via the new
ruleset or via pre-existing protection that already covers it.

## Green-before-merge amendment, 2026-07-23

`site.scaffold` ruleset `18745048` now requires the stable `merge-gate`
context, with strict up-to-date checking and no bypass actors. All three merge
methods remain available, and repository auto-merge is enabled.

PR #92 was the first live proof. Auto-merge was armed while the required
context was absent, and GitHub kept the PR blocked. The complete CI fan-in
finished at 12:04:08Z; GitHub merged the PR at 12:04:10Z. This
documentation-only PR is the independent canary required by issue #91.

## Follow-up

The ~140 non-load-bearing spawned spokes are not covered by this pass.
Rolling the same ruleset out to them is a separate, larger batch. Most of
them are unprotected today for the same "template had nothing to propagate"
reason this scaffold was.
