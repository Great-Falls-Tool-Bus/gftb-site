# Production convergence contract

Status: generic source contract; per-product carrier installation is separate
Coordination: TIN-489, TIN-3065

A site.scaffold product has exactly one durable history and exactly one
mechanism that makes production match it. Everything else is PR-scoped and
temporary. This pattern is cross-cutting: it binds every site.scaffold product
regardless of taxonomy role. Stateful, multi-tenant products additionally
bind the [stateful-workload addendum](stateful-workload-convergence.md):
the state-backend contract, the one-published-module instantiation rule, the
carrier/PR-env separation, the three-plane destroy rule and the
destructive-plan halt that §2's no-gate rule does not license away, the
PR-environment data lifecycle and its destroy-path ownership,
receiver-before-deletion ordering, and the arming gate that §5's kill switch
does not replace.

## 1. Single durable branch

`main` is the only long-lived branch of a site.scaffold product. Every
non-production environment is PR-scoped: created and reaped by the product's
owner overlay under its reviewed lifecycle contract. Lane metadata in
[`docs/CI-SCHEMA.md` §2](../CI-SCHEMA.md) grants no create, apply, DNS, or reap
authority. A branch named for an environment
(`prod`, `production`, `release`, `staging`) is not a second history; it is
drift, and the contract test fails on any workflow that addresses one.

## 2. Pre-merge admission

All acceptance evidence — including QA exercised on the PR-lane environment —
exists before merge. Merge to `main` is the production decision. No
post-merge human approval gate may sit between `main` and production; a
reviewer who is not satisfied blocks the merge, not the converge. Ratified
2026-07-29, TIN-3065.

## 3. One converge carrier

Each product names exactly one carrier: the single mechanism that reconciles
production to `main`. Two carriers is two authorities and therefore none.
Every converge emits a runtime receipt containing:

- the resolved `main` commit SHA;
- the artifact digest that was applied; and
- served evidence from the running surface.

Receipts are runtime evidence, not source. They are never checked in.

## 4. Pin the symbol

Durable binding and policy documents reference `main` by name. The symbol is
the durable claim; the resolution is a runtime fact that belongs in a receipt.
A 40-hex commit SHA may appear in a durable document only inside the
receipt-recorded binding claim defined by the
[application owner-overlay apply plane](owner-overlay-apply-plane.md).
Everywhere else, SHAs are receipt-only: a checked-in SHA outside that claim is
a stale answer to a question only the carrier may answer at converge time.

## 5. Kill-switch as code

Convergence is halted only by a reviewed `enabled: false` in a checked-in
workflow-state document that the carrier reads. Halting is a decision with
history: who, when, and why are recoverable from the commit that flipped the
toggle. An out-of-band disable — a dashboard click, a suspended workflow, a
deleted credential — is drift, and a drift check comparing the checked-in
toggle to live carrier state will fail once one is wired, until the halt is
either reverted or captured as the checked-in toggle. No such drift check
exists yet — today an out-of-band disable produces silence, and this clause
binds by review convention only.

## Epistemics of convergence proof

Ratified operator discipline (2026-08-09; originated in the TIN-489/TIN-3065
estate-contraction plan). This section is doctrine for how convergence claims
are made and read; it adds no machine-contract clause.

**The proof ladder.** A convergence claim lives at exactly one of three
levels, and a claim at one level never substitutes for the next:

- **PINNED** — merged or declared in git. The decision exists; nothing about
  the running system follows from it. (An alerting fix sat pinned for a day
  while the cluster evaluated the old rule; a shipper sat "armed" in host
  declarations while no host ran it.)
- **RUNNING** — deployed and active on the surface. The mechanism executes;
  that it executes *correctly* does not follow. (A garbage-collection timer
  reported weeks of green while a lenient wrapper swallowed the failure it
  existed to surface.)
- **SERVED** — observable through the real edge. Only this level proves
  production: the served health commit fetched through the actual public
  edge. CI green is a PINNED-level fact. A pod-local curl with a synthetic
  Host header is at best RUNNING-level. Neither is SERVED.

**The claim discipline.** Every convergence claim in a receipt, report, or
review tags itself **OBSERVED** — with the observation attached (command and
output, not a description of one) — or **INFERRED**. An INFERRED claim never
closes a gate, satisfies a review, or grounds a deletion; it is a hypothesis
awaiting its observation. (A report once claimed monitors were armed that a
process-table read proved absent; a receipt once asserted a host "remains
contained" from a week-old read while the host was live in a failure loop.
Both were INFERRED claims wearing OBSERVED clothing, and both were caught
only by adversarial re-verification.)

The carrier's runtime receipt (§3) is the SERVED-level oracle this pattern
builds toward; until a product's carrier is live, its convergence claims can
honestly reach RUNNING at best, and reviews should read them that way.

## Machine-readable contract

- Adversarial contract:
  [`scripts/test-production-convergence-contract.py`](../../scripts/test-production-convergence-contract.py)
- Repository entrypoint: `just production-convergence-contract`
- Conformance wiring: `scripts/check-conformance.sh`
- CI gate: the `production-convergence` job in
  [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), required
  through `merge-gate` on every PR

The contract test covers:

- SHA literals in binding documents outside the receipt-recorded claim;
- SHA literals in durable prose documents (`docs/**/*.md`, `AGENTS.md`)
  outside the explicit allowlist of legitimate examples;
- checked-in runtime receipts;
- workflows addressing durable environment branches — as `refs/heads/`
  refs or as entries in an `on.*.branches` filter;
- workflow-state documents whose `armed` toggle (gated arming) is not the
  checked-in literal `false` beside a distinct `enabled` toggle; and
- converge-carrier declarations that name no carrier (or two), whose declared
  carrier workflow is missing, whose carrier resource is not a tofu address,
  or whose checked-in workflow-state toggle document is missing, lacks an
  `enabled` toggle, or is unreferenced by the declared carrier workflow.

A product that converges declares its carrier in
`config/production-convergence.json` with exactly one of:

- `carrier_workflow` — the carrier workflow path, which must exist under
  `.github/workflows/` and reference the workflow-state document; or
- `carrier_resource` — the tofu address of the carrier resource inside the
  declared stack (e.g. `module.site.kubernetes_cron_job_v1.tofu_agent`; an
  optional count/for_each index suffix — `[<digits>]` or `["<key>"]` — is
  admitted on the final segment only, e.g.
  `kubernetes_cron_job_v1.tofu_agent[0]`, for carriers count-gated during
  bootstrap-import; see [converge-agent](converge-agent.md) §6);

plus `workflow_state_document` — the checked-in workflow-state toggle path
(§5). Declaring both carriers, or neither (an emptied declaration), fails the
contract test: a declaration that names no carrier is a converging product
with no declared carrier, not an opt-out. The scaffold itself carries no
declaration; a product with no declaration file is out of scope — the
template-repository default.

## Non-authorization

This source contract does not create a carrier, grant deploy credentials,
apply infrastructure, promote an artifact, or prove that production currently
matches `main`. Each of those remains a separately reviewed action in the
repository that owns it, and the only proof of convergence is a runtime
receipt emitted by the carrier.
