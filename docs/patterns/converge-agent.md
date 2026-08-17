# Converge-agent carrier

Status: generic source contract; per-product carrier installation is separate
Coordination: TIN-489; realizes
[production convergence](./production-convergence.md) §3 (one carrier) and §5
(kill-switch as code)

The converge-agent carrier is the reference shape for the single mechanism that
reconciles production to `main`: an in-cluster CronJob, declared inside the
product tofu stack it converges, that pulls the overlay repository on an
interval. It replaces a push-triggered CI job; it never runs beside one.

## 1. Self-managed: the carrier is a resource in the state it applies

The CronJob is declared in the same tofu stack whose plan/apply it runs, so
the carrier is inside its own desired state. That buys a structural property
for exactly one class of out-of-band edit — and the two classes must never be
conflated:

- **Edits that leave the CronJob ticking — schedule change, image swap, spec
  drift — are STRUCTURALLY HEALED.** The mutated carrier still runs, the next
  tick plans its own definition back, and the drift is applied away. No
  detector participates; this failure class is retired, not watched.
- **`suspend` or `delete` of the carrier is the RESIDUAL OUT-OF-BAND HALT
  SURFACE.** A suspended or deleted CronJob never ticks again, so the only
  reconciler that could heal the edit is the thing the edit stopped. Nothing
  remains to plan the halt away. This class is DETECTED, never impossible.

The residual surface is narrow but real. It is restricted to
cluster-privileged identities — `kubectl patch`/`kubectl delete`, dashboard
toggles such as Lens or K9s — and it is equivalent in effect to an unreviewed
kill-switch flip. What the pattern RETIRES is the repo-side click-disable
class: Actions variables, GitHub UI workflow switches — the clicks that cost
this estate its cron converge on 2026-07-15 and 2026-08-02, each time leaving
the tree unchanged and the estate claiming a convergence it no longer
performed. What the pattern does to the cluster-side surface is NARROW it. It
does not eliminate it.

Because the residual class is detected rather than impossible, adoption
REQUIRES a named carrier-liveness detector as a prerequisite, alerting on
both:

- the carrier's `kube_cronjob_spec_suspend == 1`; and
- last-success staleness beyond N intervals.

The suspend flag needs its own alert clause: a schedule-aware freshness rule
that excludes suspended jobs from staleness scoring does not cover the
suspend case — that is exactly the rule that goes quiet at the moment the
carrier is suspended.

The published module enforces this prerequisite structurally:
`carrier_liveness_alert_ref` is a required input with no default and the
empty string refused, and the named detector rides the CronJob as the
`tinyland.dev/carrier-liveness-alert` annotation, so an instantiation
without a named detector refuses to compose. What the module cannot prove
is that the named rule exists and fires — that remains an adoption receipt,
owned by the tenant's observability surface.

## 2. The loop, in order

Each tick, in this order, halting on the first failure:

1. **Clone** the overlay repository `main` over SSH with a read-only deploy
   key. Read-only is the credential boundary: the carrier can never write the
   history it obeys.
2. **Read the workflow-state document first.** Parse the checked-in `enabled`
   flag before any registry read, plan, or apply, and exit `0` quietly when it
   is `false` — no plan, no alert, no page. A halted tick is a successful tick;
   a halted carrier is a healthy carrier, and a carrier that alerts while
   halted will be silenced out of band, which is the drift §4 exists to
   prevent.
3. **Resolve the image digest at plan time.** Read the registry's moving tag
   and resolve it to an immutable `sha256:` digest; the apply pins the digest.
   The tag names *which* line to follow; the digest is *what* gets applied.
   A moving tag reaching an apply is a defect, not a convenience.
4. **Plan and apply** against the state backend, relying on that backend's
   lock, with `concurrencyPolicy: Forbid` on the CronJob. Two locks, two
   layers: the schedule cannot overlap itself and the state cannot be written
   twice.
5. **Wait for the rollout** to complete — pinned is not running.
6. **Assert the served sha at the real edge**, through the public hostname and
   its full ingress path, and exit non-zero on mismatch. Running is not
   served; a pod curl is not evidence.

Steps 5 and 6 are the receipt content required by
[production convergence](./production-convergence.md) §3 — resolved commit,
applied digest, served evidence — emitted at runtime and never checked in.

### 2a. Two repositories, two SHAs

Steps 3 and 6 are **application-repository** facts; step 1 is an
**overlay-repository** fact, and conflating them makes both wrong.

The overlay repository carries the tofu the agent plans and applies. The
application repository carries the code the edge serves and the CI that
publishes the image. Where a product splits the two — which is every product
in the estate — the overlay head and the application head are unrelated
commits, so:

- the image tag derived in step 3 must be built from the **application** sha,
  because that is the sha the application's CI tagged the image with; and
- the sha asserted in step 6 must be compared to the **application** sha,
  because that is what the running code reports.

An agent that uses the overlay sha for either is not merely imprecise: it
resolves an image reference that was never published and asserts an equality
that can never hold. It fails on every tick, and — because the assert comes
after the apply — it fails *after* changing production.

The application head needs no clone: `git ls-remote <url> refs/heads/<branch>`
is one network round trip and no working tree.

### 2b. The health field is a tenant fact

Step 6 reads a commit sha out of a health payload. The **path** to that sha is
per-product and must be an input, never a constant in the loop. Observed in
the estate: `medicalmassagespecialists.com/api/health` serves
`.build.commitHash` and has no top-level `.sha` at all. A loop that hard-codes
a path reads `null` at any product that spells it differently — again, after
the apply.

A product whose health endpoint serves **no** sha cannot be converged by this
pattern at all; adding one to that product's health route is a prerequisite,
owned by that product's repository.

## 3. No trigger surface in the serving loop

The carrier is pull-shaped end to end. No `push`, `repository_dispatch`, or
`workflow_dispatch` trigger appears anywhere in the serving loop, and no
external event is permitted to cause a converge. Merging to `main` does not
notify the carrier; the carrier notices on its own schedule.

This is not latency tolerance dressed as principle. An ingress trigger is a
second authority — anything that can fire the loop can be revoked, throttled,
rate-limited, or mis-scoped, and its absence is indistinguishable from a quiet
estate. A carrier that only pulls has no such failure: either the CronJob is
in the applied state or the state itself changed under review.

The corollary binds hard: **do not add a manual "converge now" button.** The
interval is the contract. Wanting a faster converge is a schedule commit.

A second carrier can hide behind indirection: a workflow step that runs a
wrapper — `just production-converge`, a `make` target, a checked-in script —
whose body performs the apply carries no apply verb for a static pin to
catch. The contract template is honest about that limit. Its static layer is
verb-blind where it can be: any workflow whose uncommented text references
the converged stack's directory or its state key is a violation regardless of
verb. The class that names neither is bounded structurally, not textually: a
second carrier needs the state-backend credential, and that credential's
custody is declared only in the carrier's own `secretRef` inside the stack —
CI runners are never provisioned with it, so a workflow-side second carrier
fails at backend init. Static pins catch the direct class; credential custody
is the structural boundary for the rest.

## 4. Halting is a reviewed pull request

The kill switch is EXACTLY ONE: a reviewed PR flipping `enabled` to `false`
in the checked-in workflow-state document (§2 step 2) — the shape
[production convergence](./production-convergence.md) §5 requires
("halted only by a reviewed `enabled: false`"). A commit carries authorship,
timestamp, and reviewable intent; nothing else does.

Removing the carrier resource from the stack is not a second kill switch: it
is DECOMMISSIONING the product's convergence entirely — a stack revision that
ends the loop, not a switch that pauses it.

Everything else — a suspended object, a deleted secret, a scaled-down
namespace, a revoked deploy key — is drift under
[production convergence](./production-convergence.md) §5 and stays a failure
until it is either reverted or captured as the checked-in flag. The mechanism
that makes it *stay* a failure is named, not implied: the §1 carrier-liveness
detector fires on the suspended or missing carrier and keeps firing;
restoration is a human-driven reviewed change. The detector pages — it never
repairs.

Halting is never an operator gate between `main` and production. Acceptance
evidence lands before merge ([production convergence](./production-convergence.md)
§2; [operator gate handoff](./operator-gate-handoff.md) §6), and merge is the
production decision. The `enabled` flag is an estate-level stop, not a
per-merge approval, and using it as one reintroduces the post-merge human gate
that §2 forbids.

## 5. Failure modes retired

| Retired | How |
| --- | --- |
| Repo-side click-disable of the converge (Actions variable, workflow UI switch), tree unchanged | no trigger surface; carrier self-managed (§1, §3) |
| Production served by no repo-declared writer after an overlay is evicted | the writer is a resource in the product stack, so losing it is a visible diff (§1) |
| A halt nobody can date or attribute | halting is a commit (§4) |
| A mutable tag applied, then silently re-pointed | digest resolved at plan time, digest applied (§2.3) |
| Overlapping applies racing the same state | `Forbid` plus the backend lock (§2.4) |
| "Merged and green" reported as shipped | rollout wait plus real-edge served-sha assert (§2.5, §2.6) |
| A converge credential that can also rewrite history | read-only deploy key (§2.1) |

Not in this table: cluster-side `suspend`/`delete` of the carrier. That
surface is narrowed and DETECTED (§1's required liveness detector), never
retired — listing it here would repeat the exact overclaim §1 forbids.

## 6. Adoption path: the declaration schema revises WITH first adoption

`config/production-convergence.json` originally declared only
`carrier_workflow`, and
[`scripts/test-production-convergence-contract.py`](../../scripts/test-production-convergence-contract.py)
required that path to exist under `.github/workflows/`. A converge-agent carrier
is a stack resource, not a workflow; that schema could not express it.

The resolution is committed, not deferred: the schema revision is staged in
this repository ahead of the first adoption (TIN-489 L15, MMS) — see the
"Machine-readable contract" section of
[production convergence](./production-convergence.md) for the revised schema.
The revision does two things:

- `config/production-convergence.json` gains exactly-one-of
  `carrier_workflow` | `carrier_resource`, where `carrier_resource` is the
  tofu address of the carrier inside the declared stack — an optional
  count/for_each index suffix (`[<digits>]` or `["<key>"]`) is admitted on
  the final segment only, so a first adopter can count-gate the carrier
  during bootstrap-import (e.g. `kubernetes_cron_job_v1.tofu_agent[0]`); and
- a declaration that names no carrier — neither key, or an emptied document —
  is a FAILURE for any product that carries `production-convergence.json`
  (declaring both is equally a failure: two carriers is two authorities).
  Previously deleting the carrier declaration passed silently — the contract
  test simply stopped looking, leaving a converging product with no declared
  carrier. That silent pass is the defect the revision closes. A product with
  no declaration file remains out of scope: the template-repository default.

With the schema revision staged here, the first adoption change carries the
remaining two things in one reviewed diff: the deletion of the workflow
carrier and the `carrier_resource` declaration. No interim state exists in which both
carriers run — the one state §3 of the convergence contract forbids — and
none in which a converging product is undeclared. Delete the workflow in that
same change; do not run both and do not "leave the old one disabled".

## Machine-readable contract

There is ONE loop body and ONE copy of each law. Both are in the published
module, and everything else references them:

| Surface | Home | Judged by |
| --- | --- | --- |
| The serving loop | [`modules/converge_agent/carrier/converge-agent.sh`](../../modules/converge_agent/carrier/converge-agent.sh) | the module suite, by EXECUTING it |
| The CronJob it runs as | [`modules/converge_agent/templates/converge-agent-cronjob.yaml.tftpl`](../../modules/converge_agent/templates/converge-agent-cronjob.yaml.tftpl) | the module suite, by rendering it |
| Tenant-declaration laws | [`modules/converge_agent/contract/tenant_contract.py`](../../modules/converge_agent/contract/tenant_contract.py) | the module suite, by mutation |
| The adopter's check | [`scripts/test-converge-agent-contract.example.py`](../../scripts/test-converge-agent-contract.example.py) | it is an IMPORTER of the row above |

An illustrative CronJob manifest used to sit under `docs/patterns/reference/`,
and a contract-test template used to carry its own six checkers. Both are
deleted. They were a second loop body and a second copy of the laws, and both
had gone stale against the module: the illustrative loop hard-coded
`jq -r .sha` and compared the served sha to the OVERLAY clone's HEAD — the two
defects the module fixed — and the template returned no violations for it.
A duplicate that certifies the defect its original forbids is the exact cost
of duplication, so the estate keeps one of each.

The module carries the loop-body laws (kill-switch ordering, digest-not-tag,
main-only, two-locks, no-trigger-surface, rollout wait and real-edge assert).
An adopter's check carries only what an adopter DECLARES: the carrier is
declared inside the stack it converges, no bespoke loop sits beside it, no
workflow references the converged stack's directory or its state key
(verb-blind — the static half of the second-carrier boundary in §3), the
reviewed document carries a boolean `enabled` and a distinct boolean `armed`,
any `destroy_admission` enumerates exact addresses with a reason, the stack
declares `ephemeral` and a production stack declares it false, and every
durable-data resource carries `prevent_destroy` and is declared to the carrier.

Trigger scanning ignores comments. Prose naming a banned literal is not the
banned literal, and a manifest that documents its own absence of triggers must
not fail for saying so.

Schedule suitability, whether the deploy key is genuinely read-only at the
forge, and whether a converge actually happened are runtime truth — receipts,
never source assertions.

## Non-authorization

This source contract does not create a CronJob, provision a deploy key, grant
state-backend credentials, apply infrastructure, promote an artifact, delete
an existing carrier, or prove that any production surface currently matches
`main`. Each remains a separately reviewed action in the repository that owns
it.
