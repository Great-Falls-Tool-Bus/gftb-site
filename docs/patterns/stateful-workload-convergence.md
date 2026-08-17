# Stateful-workload convergence addendum

Status: generic source contract; per-site instantiation is separate
Coordination: TIN-3293, TIN-1722, TIN-1895, TIN-489; extends
[production convergence](./production-convergence.md) §1–§5 and the
[tofu-agent carrier](./converge-agent.md) reference shape to stateful,
multi-tenant products.

The base doctrine converges a serving edge. Everything it names is
REBUILDABLE: a pod, a deployment, a route, an image pin. Its central move —
an unattended apply on an interval, with no human gate between `main` and
production — is safe precisely because the worst outcome is a bad revision
that the next converge replaces.

A stateful product adds authorities a static spoke never holds: a tofu state
backend, a runtime namespace, and surfaces that are not rebuildable — a state
file, a volume, a database. For those, the worst outcome is not a bad
revision; it is an absence with no source of truth to converge back from. The
same unattended loop, pointed at the same plan, becomes a data-loss engine.

This addendum pins how those authorities are named and held, bounds the loop
against them — without reintroducing the post-merge approval gate
[production convergence](./production-convergence.md) §2 forbids — and pins
the multi-tenancy rule: there is ONE convergence pattern, published once, and
every site — GFTB, MMS, tinyland.dev, every future spoke — INSTANTIATES it.
Nothing per-site is forked.

## 1. State-backend contract

The backend is generic S3-compatible, per
[`docs/CI-SCHEMA.md` §8](../CI-SCHEMA.md): the current Tinyland substrate is
RustFS, and the endpoint and credentials are operator/environment authority —
source never hard-codes either. Within that posture, a converging stateful
stack pins three things:

- **Locking is `use_lockfile = true`.** The S3-native lockfile is the state
  lock. No lock table, no side-channel lock service, no unlocked backend. This
  is the backend half of the two-lock rule in
  [tofu-agent carrier](./converge-agent.md) §2.4; the carrier's
  `concurrencyPolicy: Forbid` is the schedule half. Two locks, two layers:
  the schedule cannot overlap itself and the state cannot be written twice.
- **Exactly one state key per (stack, environment).** The key names the site,
  the stack, and the environment — the shape is
  `<site>/<stack>/<env>.tfstate` (for example
  `mms/application/production.tfstate`). Production is one environment; every
  other environment is PR-scoped, and a PR-lane environment's key embeds its
  PR-scoped lane identity and is reaped with the environment. Two stacks
  writing one key is two writers of one state; one stack spreading an
  environment over two keys is a split brain. Both are defects.
- **Credential custody stays in the stack.** The state-backend credential is
  declared only in the carrier's own `secretRef` inside the stack it converges
  ([tofu-agent carrier](./converge-agent.md) §3). CI runners are never
  provisioned with it; that custody boundary is what makes a workflow-side
  second carrier fail at backend init instead of racing the real one.

## 2. One published module, N instantiations

The carrier loop is authored once and published once. The publication
mechanism is the org's registry-first extraction shape (TIN-2030): consumers
reference a reviewed version through the registry, `tinyland-inc/bazel-registry`
before BCR, and policy documents ride the published package
(TIN-2698's packaging shape) rather than being copy-pasted alongside it.
Copying the module body into a site repository is drift — the SSOT rule is
reference, never duplication.

A site holds exactly its input set, and the input set is the complete
per-site authority:

| Input              | Meaning                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| overlay repository | the git remote whose `main` the carrier clones read-only                                                    |
| stack path         | the tofu stack directory inside that repository (e.g. `tofu/stacks/application`)                            |
| state coordinates  | S3-compatible bucket plus the §1 state key                                                                  |
| registry image ref | the moving tag whose digest is resolved at plan time ([tofu-agent carrier](./converge-agent.md) §2.3)   |
| health endpoint    | the real-edge URL asserted after rollout ([tofu-agent carrier](./converge-agent.md) §2.6)               |
| namespace          | the runtime namespace the instantiation owns                                                                |

§11 extends this set with the stateful inputs and states exhaustively what a
tenant holds versus what the SSOT owns.

**NOTHING per-site is forked.** A per-site behavioral difference is either an
input to the published module or a reviewed upstream change to the pattern
itself. A forked loop body — a site-local copy with "one small tweak" — is a
second authority wearing the first one's name, and it is drift the moment the
upstream moves.

Multi-tenancy is verified, never declared: N sites converge through N
instantiations of the one module against N disjoint state keys and N disjoint
namespaces, and each instantiation emits its own runtime receipt — resolved
`main` commit, applied digest, served evidence
([production convergence](./production-convergence.md) §3). Two tenants
sharing a state key, a namespace, or a state-backend credential fail the
isolation contract regardless of how green their converges look.

## 3. Three planes, three owners

Every resource a converging stateful stack touches falls into exactly one
class, and the class decides who may destroy it.

| Plane | Examples | Converged by | May the carrier destroy it? |
| --- | --- | --- | --- |
| Rebuildable runtime | Deployment, Service, ConfigMap, Ingress, image pin | the carrier, freely | YES |
| Control state | the stack's own state file | the carrier, under the backend lock | NO — the state is the record, not a resource |
| Durable data | PersistentVolumeClaim, PersistentVolume, bucket, database and its contents | the carrier may CREATE and UPDATE | NO |

The law is one sentence: **a converge may create and update all three planes;
it may destroy only the first.**

Three source properties make that mechanical rather than aspirational:

- every durable-data resource carries `prevent_destroy` in the stack that
  declares it — the last-resort stop inside the tool itself;
- any PersistentVolume backing a converged workload has reclaim policy
  `Retain`, never `Delete`. A `Delete` policy hands the substrate's garbage
  collector a destroy path the carrier cannot see, cannot plan, and cannot
  receipt; and
- durable data is declared in the stack, never in a rebuildable resource's
  inline spec. A volume that exists only as a field of a Deployment is
  destroyed by a Deployment replacement — the carrier's most routine act.

## 4. The destructive-plan rule

[Production convergence](./production-convergence.md) §2 forbids a post-merge
human approval gate. That stands. It is not a licence to apply a destroy.

Each tick, after planning and before applying, the carrier classifies its own
plan:

- the plan is a no-op, or contains only creates and in-place updates →
  **apply**, per the base loop;
- the plan contains a destroy or a replace of any §3 durable-data resource →
  **halt, non-zero, apply nothing.** Emit a receipt naming the exact resource
  addresses the plan would have destroyed, and page.

**This is not a gate.** A gate withholds a reviewed change pending a human
click. This withholds nothing review approved: the reviewer approved a source
diff, and a destroy the diff turned out to imply is not the thing that was
reviewed. Halting is the carrier refusing to exceed its own mandate — the
same refusal `prevent_destroy` performs one layer down, lifted up so it
produces a named receipt instead of an opaque apply failure.

The unblock is a source act, not a click. An operator authors a change that
either removes the destroy from the plan, or admits it: a `destroy_admission`
entry in the same checked-in workflow-state document that carries the kill
switch ([production convergence](./production-convergence.md) §5), naming

- the exact resource addresses admitted — enumerated, never a prefix, a type,
  a wildcard, or `all`; and
- the reason.

An admission is consumed by one converge and expires; the next tick reads a
document with no admission in it. An admission naming a class rather than
addresses is not an admission, it is the rule deleted, and the contract test
fails it. Like the kill switch, an admission is a commit: authorship,
timestamp, and reviewable intent are recoverable, and no dashboard, flag, or
environment variable can produce one.

## 5. Schema migrations

A migration is a converge-time resource, not a step someone bolted into the
carrier loop.

- **It is declared in the stack**, as a job keyed by the migration's own
  identity. It is therefore planned, digest-pinned, locked, and receipted
  like every other resource. A migration executed by a shell line inside the
  carrier is unplanned and unreceipted — the one act in the loop with
  irreversible effect, and the only one nobody reviewed as a diff.
- **Ordering is declared, never timed.** The new revision's rollout depends
  on the migration's completion. A sleep is not an ordering primitive.
- **A converge migration is expand-only.** It may add a table, a column, an
  index, a nullable field. It may never drop, narrow, or rename one.
  Contraction is a separate, later, reviewed converge that runs only after
  the expanded shape has been serving. Every schema change is therefore at
  least two merges. That cost is the price of §6, and it is not negotiable
  per-tenant.
- **It is idempotent and keyed.** The carrier ticks on an interval; a
  migration that is not a no-op on its second run will get a second run.

## 6. Rollback is asymmetric

The base doctrine's rollback is implicit and correct for an image pin: revert
the commit, the next tick converges backward. For a stateful product that
implication is false, and leaving it unstated is how an operator learns it
during an incident.

**Reverting a commit reverts the source. It never reverts the data.**

| What changed | Does reverting the commit undo it? |
| --- | --- |
| Image pin, configuration, replica count, route | YES — symmetric, converges backward on the next tick |
| Expand migration | NO. The schema stays expanded. The reverted revision must be able to serve against it — which is exactly why expand-only exists, and that state must be tested, not hoped for |
| Contract migration | NO, and unrecoverably: the previous revision can no longer serve. A contract is a one-way door |
| Durable data | NEVER, by any carrier, under any circumstance |

Two consequences bind:

- a contract migration's commit message states that it closes the rollback
  path past that point. A one-way door with no sign on it is the defect; the
  door itself is legitimate; and
- restoring data is an attended operator ceremony against a backup, under its
  own runbook. It is not a carrier path, not a converge, and not something a
  receipt can claim.

## 7. PR-environments: the QA LOOK loop and the data lifecycle

PR environments are PR-scoped, full stop: created and reaped by the product's
owner overlay keyed on PR state, per
[`docs/CI-SCHEMA.md` §7](../CI-SCHEMA.md) and
[production convergence](./production-convergence.md) §1. Acceptance evidence
— including the human LOOK on the PR-lane URL
([operator gate handoff](./operator-gate-handoff.md) §5) — exists before
merge, because merge is the production decision
([production convergence](./production-convergence.md) §2).

### 7.1 The structural boundary

The carrier converges ONLY `main`. It never creates, applies to, or reaps a
PR environment; the PR-env producer/reaper is a separate, PR-keyed mechanism
writing only PR-scoped state keys. The boundary binds in both directions:

- a carrier that reads any ref but `main` is a second history; and
- a PR-env mechanism that touches the production state key or namespace is a
  second carrier.

Either is the two-authorities defect
[production convergence](./production-convergence.md) §3 exists to prevent.

Every instantiation gets the same three mechanisms, not a per-site remix: the
PR-scoped env with its LOOK loop before merge, the `main`-only carrier after
merge, and the same gitops pattern binding them. main==prod is the product of
all three, at every site.

### 7.2 The data lifecycle

**Provision.** A PR environment holds its own state key, its own namespace,
AND its own durable data. Never a share of production's. A PR environment
sharing production's database means a mechanism designed to be destroyed
automatically holds a destroy path into production data.

**Seed.** PR-environment data comes from a checked-in fixture, or from a
snapshot passed through a named, reviewed anonymizer. Cloning production data
into a PR-scoped environment is prohibited: the environment's entire
lifecycle is "created and reaped by a mechanism keyed on PR state", and real
data inside something built to be destroyed on a schedule is how a routine
reap becomes a breach.

**Apply.** The same module and the same loop as production, with a different
input set. A PR environment that converges by a different mechanism is a
second carrier wearing a short lifetime.

**Reap.** This is the step this estate keeps failing, so it is spelled out:

1. **The destroy path lives with the thing it destroys.** The mechanism that
   reaps a PR environment is owned by the same repository that provisions it
   — the product's owner overlay. A destroy path in a third repository is an
   orphan generator: when that repository sheds the substrate, the
   environments outlive their own reaper.
2. **The verb is derived from live PR state, never from the caller.** A reap
   request carries a PR identifier; the reaper resolves that PR's state at
   the forge and destroys only on a definitive closed or merged answer. A
   caller-supplied verb is a delete primitive with a number attached.
3. **Unknown never destroys.** A reaper that cannot resolve PR state fails
   loudly and leaves the environment standing. Fail-closed on destroy: a
   stale environment costs capacity, a wrong destroy costs data.
4. **A TTL backstop exists and is independent of the CI fleet.** It is the
   only leg that still runs when the runner pool is saturated or offline, and
   it obeys rules 2 and 3 identically.
5. **Reaping durable data is a destroy, and §4 applies — pre-admitted at
   provision, not per-reap.** A stack declares `ephemeral: true` at birth,
   and that declaration is the standing admission to destroy the durable data
   it owns. A stack that declares `ephemeral: true` MUST NOT be a production
   stack; a production stack declares `ephemeral: false` and can never carry
   the standing admission. One boolean, declared once, decides whether the
   reaper is a lifecycle or an incident.

## 8. Receipts for a stateful converge

[Production convergence](./production-convergence.md) §3 requires three
items: resolved `main` commit, applied digest, served evidence. A stateful
converge emits three more:

- **the state serial and lineage after apply** — the state's own identity,
  which makes two writers of one key detectable in evidence rather than only
  in theory;
- **the migration identities applied on this tick** — empty is a valid and
  common value, and a non-empty value dates every one-way door from §6; and
- **a data-plane readback** — one probe proving the workload can read what it
  owns. The served-sha assert proves the front door opened; it says nothing
  about the volume behind it.

A destructive-plan halt (§4) emits a receipt too, naming the addresses it
refused. A halted tick is a receipted tick — the same rule
[tofu-agent carrier](./converge-agent.md) §2.2 applies to a kill-switched
tick, extended to the one other case where the carrier legitimately declines
to act.

## 9. Receiver-before-deletion ordering

**When authority moves between repositories, the receiving mechanism lands
and is PROVED before the sending mechanism is deleted.** In this order, no
step skipped, no step merged into another:

1. the destination declares and lands the receiver;
2. the receiver is proved end-to-end against a real instance — provision,
   apply, and reap all exercised at the destination, using only the
   destination's own credentials;
3. consumers are re-pointed at the destination, one at a time, each with its
   own receipt; and
4. only then is the origin's copy deleted.

Deleting at step 4 before step 2 has happened here more than once. The
canonical case is TIN-1895: a substrate eviction removed the receiving end of
a product's PR lanes before that product's owner overlay had one, and the
product's own adoption ticket has been blocked ever since — the sender still
ships, aimed at nothing.

The harm is not the deleted file, which a rescue branch preserves. The harm
is the **orphan**: a live namespace, a live volume, a live DNS record whose
own destroy path was deleted before it was. An orphan cannot be reaped by the
mechanism that made it, because that mechanism is gone. It can only be found
by an inventory sweep and destroyed by hand — precisely the attended,
unplanned, data-destroying act this entire pattern exists to prevent.

Two corollaries bind as hard as the rule:

- **A mechanism that can create is deleted only after the things it created
  are gone.** Before an eviction merges, the inventory of live objects the
  evicted mechanism owns is EMPTY, and the emptiness is proved IN the
  eviction change. A drained estate is a precondition of eviction, never a
  hoped-for consequence of it.
- **A rescue branch is a recovery aid, not a receiver.** Capturing the
  deleted paths on a branch satisfies step 4's paperwork and none of step 2's
  proof. Restoring from a rescue branch is an incident, not a plan.

## 10. Gated arming: code present, unarmed

The kill switch stops something that is running. Gated arming is its
complement at the other end of the lifecycle: it lands the mechanism —
reviewed, complete, and inert — in a state where it does not yet act.

The convention is already proven in this estate's cluster-substrate Ansible
roles for scheduled containerd image GC and for ZFS off-node backup:

- the apply installs everything — script, units, schedule, permissions — and
  then leaves the schedule **stopped and disabled**;
- arming is a separate reviewed change to a checked-in boolean in the host's
  own reviewed variables, plus a re-apply;
- the role ASSERTS that the effective value equals the reviewed checked-in
  value, so a command-line override cannot substitute for review; and
- the reviewed default is unarmed. An apply must never silently arm a
  schedule.

For a stateful converge carrier, gated arming is REQUIRED — not optional —
on:

- the first installation of a carrier at a new tenant;
- any change to the state key, the state backend, or the namespace; and
- the first converge after a `destroy_admission` (§4) is added.

**The arming gate and the kill switch are two flags and MUST NOT be
collapsed into one.** They differ in default and in what a flip means:

| | Kill switch | Arming gate |
| --- | --- | --- |
| Reviewed default | armed (`enabled: true`) | unarmed (`armed: false`) |
| What a flip to the other value means | an incident: stop a mechanism that has been running | a plan: run a mechanism for the first time, attended |
| What its absence would cost | no dated, attributable halt | a first run whose plan nobody saw |

A mechanism that lands armed has had its first run reviewed as a diff — the
one form of review that structurally cannot see what the first plan will
actually do to durable data. Collapsing the two flags makes "stop the runaway
carrier" and "never started it" indistinguishable in history, which is the
same defect §5 of the base doctrine retires for out-of-band disables.

## 11. What the SSOT owns, what a tenant holds

A tenant instantiates; it does not fork. The stateful input set extends §2's,
and the split is exhaustive: anything not in the middle column is not a
per-tenant decision.

**The SSOT owns** (the published module plus this doctrine): the loop order;
the destructive-plan classifier and the admission grammar; the receipt schema
including §8's three stateful fields; the `ephemeral` declaration split; the
arming gate's shape and its unarmed default; the reap verb-derivation rule
and its fail-closed behavior; and the expand-only migration rule.

**A tenant holds**, as inputs: the durable-data resource addresses that carry
`prevent_destroy`; the data-plane readback probe; the migration identity key;
the seed source; `ephemeral` true or false; and the two booleans — `armed`
and `enabled`.

**Neither owns** — these are operator ceremonies and never source: creating a
bucket, a credential, a volume, or a database; the first arming flip; any
restore from backup; and destroying durable data outside a stack that
declared itself `ephemeral`.

A tenant need that no input in the middle column can express is an upstream
change to this pattern, after which every tenant inherits the answer. A
per-tenant fork of the loop body is a second authority wearing the first
one's name.

## 12. Per-site agent names are retired semantically

Names like `mms-tofu-agent` survive only as deployment labels: each names one
instantiation of this pattern at one site, never a bespoke agent. There is no
per-site agent to design, review, or diverge — GFTB, MMS, tinyland.dev, and
every future spoke instantiate the same published module with their own §2
input set, each with the same QA LOOK PR-env setup, main==prod, and the same
gitops patterns.

The consequence binds docs and tickets, not just code: a design document for
"the X-tofu-agent" as new machinery is drift. The design surface is this
pattern and the module it publishes; a site-shaped need that the inputs
cannot express is an upstream PR here, after which every site inherits the
answer.

## Machine-readable contract

Source-checkable, and therefore contract-test material:

- every durable-data resource address a tenant declares carries
  `prevent_destroy`;
- a converging stateful stack declares `ephemeral`, and a stack declared as
  production declares it `false`;
- the workflow-state document carries a boolean `armed` whose checked-in
  default is `false`, distinct from `enabled`;
- a `destroy_admission`, when present, enumerates explicit resource
  addresses — no wildcard, no type prefix, no `all` — and carries a reason;
- the backend posture rides the existing checks: `scripts/check-conformance.sh`
  (RustFS-only substrate naming, no hard-coded endpoints) and
  `scripts/scaffold-doctor-boundary.sh` (generic S3, endpoint from
  operator/env);
- the carrier properties ride the
  [tofu-agent carrier](./converge-agent.md) contract-test template:
  digest-not-tag, enabled-flag read, no workflow reference to the converged
  stack's directory or its state key; and
- a converging instantiation declares `carrier_resource` in
  `config/production-convergence.json` per the declaration schema in
  [production convergence](./production-convergence.md).

Runtime truth, receipts only — a source assertion here would be a lie:

- lock behavior under contention, bucket ACLs, and actual cross-tenant
  isolation;
- whether a given plan was actually destructive;
- whether a reap resolved live PR state or guessed;
- whether the readback read the tenant's own data; and
- whether an orphan exists anywhere. Only an inventory sweep answers that
  question, and §9 exists because no source check ever will.

## Non-authorization

This addendum does not publish a module, provision a bucket, volume,
credential, database, or namespace, install a carrier at any site, run a
migration, destroy anything, arm any mechanism, restore any backup, or prove
that any tenant is isolated from any other or that any tenant's data is
intact. Each remains a separately reviewed action in the repository that owns
it, and the only evidence any of them happened is a runtime receipt.
