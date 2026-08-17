# Tinyland repository taxonomy and ownership contract

Status: corrected 2026-08-03 under TIN-489/TIN-3066. The original 2026-05-19
text assigned application and PR lifecycle authority to a generic Blahaj
receiver. That architecture is superseded; Git history preserves it.

## Purpose

Tinyland repositories share a small org-wide development contract without
sharing product authority. A repository declares its role, uses reproducible
Just/Nix entrypoints, validates its Bazel and CI graph, and defers every surface
it does not own to a named authority.

Transport and placement never transfer ownership. In particular, a generic
cluster or mail substrate does not acquire application state, apply, admission,
PR lifecycle, tenant Secrets, or runtime-receipt authority merely because it
hosts a workload.

## Layers

### Org-wide repository contract

- `AGENTS.md` states role, authorities, validation, and non-goals.
- `Justfile` is the human and agent command surface.
- `nix develop --command just <recipe>` is the reproducible shell path.
- Durable requirements live in source, schemas, tests, or the owning tracker.
- Secret scanning and signed, reviewed source changes are explicit.

### Bazel, package, cache, and RBE

- GloriousFlywheel owns cache/RBE product truth and target eligibility.
- `MODULE.bazel` plus the Tinyland registry are package authority for Bazel
  consumers.
- Cache hits are not remote-execution proof.
- OpenTofu, developer servers, and image publication are never RBE classes.

### Static spoke

- A static spoke is a read-only projection consumer, not an application
  backend.
- It owns no auth, payments, user data, ActivityPub delivery, or mutation API.
- `.github/lanes.json` is build and QA metadata only. It grants no receiver,
  state, apply, DNS, or reaping authority.
- Static publication uses the product's declared atomic-publish path.

### Mothership

`tinyland.dev` owns content, broker, admin, profile, and federation authority.
It consumes shared package/cache contracts but is not a static projection
consumer.

### Application or stateful spoke

- The application repo owns behavior, source, immutable artifacts, and its
  product-specific pre-merge policy.
- A dedicated owner overlay owns application state, protected exact-plan apply,
  workloads, Secrets, PR create/reap, and runtime receipts.
- The application may emit an authenticated admission signal. It does not write
  an infrastructure PR, pin, state object, Secret, or DNS record.
- Product-specific environment shape belongs to the owner overlay, not a
  generic receiver contract in this scaffold.

The concrete current instance is MassageIthaca:

- Corrected 2026-08-05: the former direction ("migrate lane/reaper wiring
  toward Blahaj contracts") is retired — blahaj #1255 evicted the MI
  substrate, and MassageIthaca's workload/state/DNS/mail/reaping authority
  belongs to the Medical-Massage-Specialists owner overlay
  (`medical-massage-specialists-infra`), with the application lane slated to
  move into that org (operator direction 2026-08-05).
- Do not reclassify it as a static spoke.
- Keep booking/admin/auth behavior app-owned; the app repo holds no infra
  apply authority.
- Express deployment variants through `.github/lanes.json` metadata and the
  owner overlay's intent, never duplicated workflow logic.

### Generic infrastructure substrate

- Generic cluster, CA, tunnel, and mail substrate may remain shared and
  replaceable.
- Substrate repositories enforce bounded admission and tenancy; they do not own
  application promotion policy or tenant mail cases.
- House-zone DNS stays with its DNS authority. Tenant DNS intent and receipts
  cross that boundary through the owning protected flow.

### Production convergence

The complete contract is
[`docs/patterns/production-convergence.md`](../patterns/production-convergence.md).

- `main` is the only durable product branch.
- Browser LOOK and a SHA-bound operator decision precede merge.
- After a product's owner carrier is activated, merge to `main` is the ship
  word and exact saved-plan convergence is automatic.
- `PINNED`, `RUNNING`, and real-edge `SERVED` are separate receipts.
- Bootstrap, import, rollback, and exception actions remain separately
  protected.

## Repository responsibilities

| Repository class | Owns | Does not own |
| --- | --- | --- |
| `site.scaffold` | Versioned role, lane-metadata, convergence, owner-overlay, and validation contracts | Runtime state, application receiver, apply plane, DNS mutation |
| `ci-templates` | Reusable source validation and artifact jobs | Product admission or runtime apply |
| GloriousFlywheel | Bazel/cache/RBE products and generic infrastructure modules | Product policy or tenant state |
| Application repo | Behavior, source, immutable artifact, admission signal | Infrastructure state/apply/Secrets/DNS |
| Product owner overlay | Exact-plan state/apply, workloads, PR lifecycle, runtime receipts | Generic cluster or mail implementation |
| Generic substrate | Replaceable cluster/mail/tunnel primitives | Product promotion and tenant policy |

## Scaffold acceptance criteria

- A new static spoke can validate, build, and publish through its declared
  static host without an application receiver.
- A new application spoke can declare lane metadata without inheriting a
  generic apply plane.
- Direct application/PR receiver code reach is rejected by
  `just substrate-boundary`.
- Adding a lane changes metadata only; the product owner separately decides
  whether that metadata has a live QA consumer.
- `tinyland.dev`, static spokes, application spokes, owner overlays, and
  generic substrates remain distinct roles.

## Historical note

The 2026-05-19 revision proposed schema-validated `repository_dispatch`
receivers, Blahaj-owned application PR lanes, shared reapers, and public-preview
overlays. The 2026-08 recovery established that this was a wrong-owner
architecture for applications. The executable workflow, sender, dispatch
schemas, App-install module, and live receiver prose were removed rather than
retargeted or replaced beside the false path.
