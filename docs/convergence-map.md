# Convergence Map — where the estate is vs. where it is going

> Living steering document (operator-directed, 2026-08-08). This is the one
> place that reconciles the ratified target architecture against live estate
> state. It names each gap and its owning lane so two things stay impossible:
> working on the wrong gap, and two lanes working the same gap. Update it when
> a gap closes or an owner changes — a stale map is worse than no map.

## The target architecture (ratified canon, converged across repos)

Five layers, one direction of flow. Three repos state this independently and
identically — MassageIthaca's `AGENTS.md` **Estate Layer Map**
(operator-ratified 2026-08-06/07), the Blahaj repo charter
(`docs/reference/repo-charter.md` in that repo, §"What Belongs In Blahaj"),
and GFTB's `AGENTS.md` convergence statement. The canon is settled;
disagreement between repos is a defect, not a debate. (Blahaj is deliberately
not linked org-qualified here — this scaffold's substrate-boundary contract
forbids direct references to the cluster-substrate repo.)

| Layer | Home | Owns | Never owns |
|---|---|---|---|
| Runtime SSOT | `tinyland-inc/GloriousFlywheel` | runner/cache/RBE products, Dhall structural law, and generic ApplicationRelease producers ([current-state.md](https://github.com/tinyland-inc/GloriousFlywheel/blob/main/docs/current-state.md) is the sole mutable status doc) | application behavior, tenant plan/apply/state |
| CI mechanics | `tinyland-inc/ci-templates` | reusable workflow mechanics | runtime truth |
| Spec + doctrine | `tinyland-inc/site.scaffold` (this repo) | taxonomy, owner-overlay binding, LOOK, convergence, and closure contracts referenced by URL | controller logic, cluster state, app bindings |
| Cluster substrate | Blahaj (the cluster repo) | honey RKE2 admission / policy / storage / mail substrate | app deployment substrate |
| App + owner overlays | app repos and `*-infra` overlays | app behavior and immutable release production; tenant binding, exact plan/apply, state, rollback, and observation | GF execution, controller, or cluster-substrate authority |

**The first reference loop is tinyland.dev's Jess/blog projection consumed by
transscendsurvival.org.** Adoption means an immutable application release is
accepted by the sole Go owner-overlay controller, consumed by the application
owner's exact-plan executor, and independently proved PINNED, RUNNING, and
SERVED. It does not mean instantiating this repository's historical shell
`converge_agent`.

## Proof ladder

Every state row in this map is a claim at one level of the
[epistemics ladder](patterns/production-convergence.md#epistemics-of-convergence-proof):
**PINNED** (in git) ≠ **RUNNING** (active on the surface) ≠ **SERVED**
(observable through the real edge) — and each row is **OBSERVED** (evidence
attached at write time) or **INFERRED** (a hypothesis, closing nothing). When
updating this map, tag which. Adoption "done" for a tenant means SERVED.

## Where we are (verified live, 2026-08-16)

- **Doctrine: enforced.** `production-convergence` is a required merge-gate job
  (R1, #133). The historical carrier source landed (#129) and was homed here
  (R0, #132); that source was never published or activated.
- **Shell carrier: historical, unpublished, and not an adoption path.** The
  source module remains checked in and narrow mechanics landed through #143 and
  #145, but no module or carrier image was published and no runtime was
  activated. Preserved #144 closed after its runtime proof and merge gate
  failed; its pull ref remains the exact evidence receipt.
- **Canonical successor: source only.** GloriousFlywheel #1518 is Draft at
  its signed pull ref; it carries the generic ApplicationRelease contract and
  external Bzlmod consumer, not publication or runtime authority. The Go
  controller and owner executor remain separately gated. No PINNED → RUNNING →
  SERVED receipt exists yet.

## Supersession notice (current 2026-08-16) — read before the gaps below

TIN-2609 supersedes the shell `converge_agent` implementation direction with
the existing GF-I09 ApplicationRelease contract, the sole private Go
owner-overlay controller, and an owner-repository exact-plan executor. GF
#1409 and #1410 landed the original structural handoff and producers; current
GF #1518 reconstructs the generic release seam on protected main.

The later merges of scaffold #143 and #145 retained useful external-consumer
and two-repository credential mechanics. They did not publish, activate, or
ratify the shell CronJob as the serving loop. The image carrier re-land #144 is
preserved-closed, not absorbed. Every registry-publication ceremony,
`enable_converge_agent` example, and runtime-clone/apply description below is
therefore historical documentation. It grants no permission to publish or
adopt the shell module.

## The gaps, each with one owner

### Gap 1 — PR-env lanes: producer/reaper now exists, still inert
Every legacy leg is deleted or deleting (MI sender, blahaj receiver, GFTB
sender). The ratified replacement is the MMS owner-overlay lifecycle contract
(`medical-massage-specialists-infra` #51/#59). **RESOLVED IN SOURCE,
NOT RUNTIME — MMS #69** authored and merged the producer
directly in-overlay: `scripts/reconcile-pr-env-lanes.sh` drives the
existing `scripts/application-plan-binding.py` `pr-upsert`/`pr-destroy`
action classes (the same lease/plan/apply sequence
`application-apply-ceremony.yml` already runs for production), called from
the rewritten `.github/workflows/pr-env-lifecycle.yml`. At current protected
MMS `main`, the previously missing preview backend and App-permission gaps are
recorded closed, but
`config/workflow-state/pr-env-lifecycle.json` remains `enabled: false` and
its reconcile/first-reap receipt fields remain null. This document grants no
activation word. Note: the producer MMS built is **not** an instantiation of
this repo's `converge_agent` module — it calls
`application-plan-binding.py` directly,
never composing a shell-CronJob loop — so per the supersession notice
above it was never exposed to the TIN-2609 hold in the first place.
**Owner: the MMS owner-overlay lane.** This repo's contribution is unchanged:
the carrier's state-key grammar admits the spoke PR-lane shape
(`spokes/<site>/pr/<n>/lanes/<lane>/opentofu.tfstate`), which is the part
of this gap's original prediction MMS #69 actually reused — not the module
itself.

### Gap 2 — the governed GF route has no ready execution receipt
The worker Deployment remains pinned at 0 replicas and no current receipt
proves a ready authenticated WorkerRoute with a non-local forced-remote action.
GF #1518 may land structural source only; no deployable ApplicationRelease may
publish until GF-I07 proves the exact target. **Owner: TIN-2609 → TIN-2730 in
the GF lane.** No scale word is granted here.

### Gap 3 — owner executors are not yet canonical consumers
MMS contains an inert, count-zero shell-module instantiation, but that is not
the replacement path. The owner overlays must instead consume an accepted
ApplicationRelease through separate planner/applier/observer identities and
produce forward plus rollback receipts. **Owner: each application owner
overlay after the canonical GF/controller seam exists.**

## What "done" looks like

An immutable application release is remotely built and published; the
controller emits Accept or typed Refuse; the owner executor applies the exact
encrypted plan without replanning; an independent observer proves PINNED,
RUNNING, and SERVED; rollback proves the prior release again; and the PR,
tracker, branches, and worktrees close. The Jess/blog projection-consumer loop
is the first reference. Publishing this shell module is not part of done.
