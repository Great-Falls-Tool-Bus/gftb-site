# Application owner-overlay apply plane

Status: generic source contract; runtime installation is separate
Coordination: TIN-3026

An application repository and the infrastructure that realizes that
application are separate authorities. Existing placement is migration evidence,
not permission to copy application-specific state or lifecycle into a shared
substrate repository.

## Authority split

| Authority | Owns |
| --- | --- |
| Application source | product behavior, source, build graph, immutable artifact publication, lane intent, and acceptance policy |
| Dedicated application owner overlay | application image pins, state, secret declarations, workloads, protected plan/apply, reaping, and runtime receipts |
| Optional owner-overlay capabilities | application-zone DNS, application database, and application mail policy when each capability is explicitly declared |
| Shared cluster substrate | consumer-neutral cluster services, admission, placement, storage classes, and other bounded substrate interfaces |
| Shared execution products | reusable runner, Bazel, Nix, cache, RBE, artifact-cache, remote-test, and OpenTofu module products |
| Host-policy authority | host bootstrap, operator preflight, and narrowly scoped credential custody or projection |

Consumption does not transfer ownership:

- an application does not gain infrastructure apply authority by declaring a
  lane;
- a shared cluster does not gain an application's workloads, identities, DNS,
  database, mail policy, state, or lifecycle because the workload runs there;
- a reusable module or runner product does not own the values, state, or apply
  that consume it; and
- credential projection does not make the projecting repository the
  application apply plane.

## One application, one binding

An application owner-overlay document binds exactly one source repository to
exactly one overlay repository. The binding repeats the source identity,
default branch, source role, and artifact-publication workflow so the overlay
can compare received intent with its declared source authority.

The artifact repository is an independent immutable-publication coordinate. It
may legitimately differ from the source repository. Equality between those two
strings is neither required nor evidence of provenance.

The overlay repository must be distinct from:

- the application source repository; and
- every shared substrate repository named by the document.

The document has no list-shaped or aliased application-binding escape hatch.
Supporting another application requires another independently reviewed owner
overlay document and authority decision.

## Binding evidence

`binding_status: declared` records source intent only. It carries no binding
receipt claim and proves no runtime state.

`binding_status: receipt-recorded` requires an immutable receipt claim
containing:

- the owner-overlay repository;
- a non-zero 40-character commit SHA;
- the repository-relative JSON document path; and
- the JSON Pointer `/application_binding`.

The feasible source ceremony is two commits: first land a `declared` document,
then record that prior revision in a later `receipt-recorded` document. Source
validation checks the claim's shape and cross-field identity but does not
dereference it. A protected observer must independently read the referenced
revision before treating the binding as installed. Neither source state proves
an image is pinned, a workload is running, an edge is served, or application
data is current; those evidence stages remain separate runtime receipts.

## Capability declaration

The owner overlay always declares its core responsibilities:

- immutable application image pins;
- application state;
- secret declarations;
- application workloads;
- protected plan/apply;
- reaping; and
- runtime receipts.

Application-zone DNS, an application database, and application mail policy are
optional capabilities. They remain `false` until the overlay actually owns
them. A generic overlay contract must not turn their presence in another
repository into implicit authority.

Unknown capability keys fail closed. New authority therefore requires a schema
revision and review instead of appearing as an untyped extension.

## Machine-readable contract

- Schema:
  [`docs/schemas/application-owner-overlay.schema.json`](../schemas/application-owner-overlay.schema.json)
- Valid generic fixture:
  [`tests/fixtures/application-owner-overlay.json`](../../tests/fixtures/application-owner-overlay.json)
- Adversarial contract:
  [`scripts/test-application-owner-overlay-contract.py`](../../scripts/test-application-owner-overlay-contract.py)
- Reusable strict validator:
  [`scripts/validate_application_owner_overlay.py`](../../scripts/validate_application_owner_overlay.py)
- Repository entrypoint: `just owner-overlay-contract`
- Document entrypoint: `just owner-overlay-validate path/to/document.json`

The JSON Schema supplies editor and single-field constraints. The reusable
validator is the fail-closed authority for duplicate-key and cross-field laws;
consumers must run it rather than treating schema acceptance alone as
conformance.

The adversarial contract covers multi-application binding, source/overlay
self-binding, shared-substrate impersonation, undeclared capabilities,
receipt-recorded bindings without immutable receipt claims, source/binding
identity mismatch, aliases, nested-field substitution, duplicate JSON keys,
nulls, invalid JSON Pointers, and type confusion.

## Non-authorization

This source contract does not create an overlay repository, move state,
install a GitHub App, grant a runner, project a secret, publish DNS, provision a
database or mail identity, plan or apply infrastructure, deploy a workload,
expose a route, or prove runtime state. Each of those remains a separately
reviewed action in the repository that owns it.
