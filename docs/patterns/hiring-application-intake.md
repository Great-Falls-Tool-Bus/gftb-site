# Hiring-application intake (careers role pages -> mail-only delivery through the app's recipient choke point)

A parameterized pattern for accepting a **job application from a spoke's careers
role pages** and delivering it **as mail only**, through the consuming app's
single recipient-resolution choke point. It is the hiring sibling of
[`community-contact-intake.md`](./community-contact-intake.md): that doc covers
a public contact form feeding an in-cluster mailing list from a static spoke;
this doc covers an application form feeding named hiring recipients from an
app-shaped spoke that already owns a lawful mail path (the MassageIthaca-shaped
contact form is the model).

> **Status: STUB - reserved pattern seat (TIN-2901).** The first reference
> implementation (MassageIthaca `src/routes/careers/apply` + the
> `getRecipientEmail` purpose classes in `src/lib/server/email.ts`) is in
> flight. This stub carries the envelope contract, the boundary, the invariant
> list, and the adoption checklist now, because consumers must pin those from
> day one; the worked, cited walk-through in the full house register follows
> when that implementation lands and is live-verified. Nothing below claims a
> live proof that does not exist yet.

---

## 1. The envelope - `hiring-application/v1`

The submission payload is the versioned envelope defined in
[`docs/schemas/hiring-application.v1.schema.json`](../schemas/hiring-application.v1.schema.json),
with a checked-in fixture at
[`docs/schemas/examples/hiring-application.v1.example.json`](../schemas/examples/hiring-application.v1.example.json).
`just hiring-application-validate` asserts the schema compiles (draft 2020-12)
and the fixture validates - offline, no cluster, no secret.

- **The in-band `envelope: "hiring-application/v1"` const is the seam.** A
  later dashboard/platform ingester routes on it. Reserving the versioned
  envelope is the ONLY integration built now; see §7.
- **Transport fields are never envelope fields.** The honeypot decoy and any
  session material are consumed and discarded by the handler before the
  envelope is constructed.
- **Resume/file transport is an open decision** (mail attachment vs link vs
  defer) and is deliberately absent from v1. It lands as an additive change
  before the kit freezes v1 in the registry, not as an in-place mutation after.

**SSOT trajectory** (the schema's home, in order):

1. **Seed**: the first consumer authors the schema app-side,
   extraction-clean - pure zod, no server or app imports, bounds and the role
   catalog as exported constants (MassageIthaca `src/lib/hiring/schema.ts`).
2. **Home**: the seed moves verbatim into the standalone
   `tummycrypt/hiring-form-kit` repo publishing `@tummycrypt/hiring-form-kit`
   (one root `BUILD.bazel` + `MODULE.bazel`, TIN-2838 ingestion), versioned in
   `tinyland-inc/bazel-registry`. **The bazel-registry version is the source of
   truth**; the npm surface is a derivation via git-tag CI auto-publish
   (`@tummycrypt` scope, per-repo `NPM_TOKEN`, never manual publish, never npm
   as an ingestion surface).
3. **Consumption**: the consumer swaps its local seed for the graph-linked
   package (`bazel_dep` + `npm_link_package`, per TIN-2838). This file's schema
   copy then tracks the registry version and stops being independently edited.

## 2. Parameterize as you copy

| Placeholder | What it is |
| --- | --- |
| `<careers-route>` | the public role-posting pages (e.g. `/careers/<role-slug>`) |
| `<apply-route>` | the form page + its mail-only server endpoint (e.g. `/careers/apply`) |
| `<role-slug-catalog>` | the consumer's allowed role slugs + display titles, pinned as an enum in the app-side schema |
| `<mail-choke-point>` | the app's single recipient-resolution function and its purpose classes |
| `<hiring-recipients>` | the named production recipients for the hiring purpose class |
| `<dev-recipient>` | the nonprod recipient every non-production lane resolves to |
| `<site-origin>` | the one allowed origin for the POST |

Role titles, copy, and posting text are the client's language verbatim and are
consumer-side, never pattern-side.

## 3. Boundary note - what stays out of the spoke

- **The app owns only**: the form markup, the client `fetch()` POST, and a
  **mail-only server route** shaped exactly like the app's existing contact
  route. **No database, no queue, no application storage, no new backend** in
  the client app (the TIN-2398-shaped boundary, generalized: an intake is
  mail-shaped or it does not belong in the app).
- **Recipient resolution happens ONLY at `<mail-choke-point>`**, through a
  purpose class dedicated to hiring. No route, template, or config resolves a
  recipient literal anywhere else.
- **Transport is estate doctrine**, not this pattern's concern: the consumer's
  sanctioned mail transport carries the delivery (for the first consumer, the
  on-prem postfix stack).
- **An estate that carries a mail law amends it in the same PR.** A hiring
  intake is a new sanctioned path for real mail to real people; the consuming
  repo's agent-contract mail law and its email-law contract tests are updated
  in the SAME PR that lands the route, never after.

## 4. Load-bearing security posture (portable)

The full posture, argued in the sibling doc §3/§9, applies here because this is
likewise a public POST that delivers real mail:

1. Honeypot with **silent fake-success** (200, send nothing; never a 400).
2. Per-client token bucket keyed on the **trusted edge IP** - keying on
   `X-Forwarded-For` is a contract-test FAILURE.
3. **CRLF sanitization** of every value that can reach a mail header.
4. **CORS locked to exactly one origin**, asserted in env AND code.
5. **Body-size cap** rejected before any read.

The first consumer's now-ship carries its existing `/contact` subset of this
posture; the remainder are **adoption-checklist items (§6), not optional
hardening**, before any wider exposure.

## 5. Contract-test invariants (consumers pin ALL of these)

1. **Choke-point-only recipient resolution.** The hiring purpose class at
   `<mail-choke-point>` is the only place a recipient is resolved; a grep for
   recipient literals outside it fails the suite.
2. **Nonprod is dev-only.** PR envs, previews, and every non-production lane
   resolve the hiring purpose to `<dev-recipient>` only. A nonprod lane that
   can mail a real recipient is a broken build, not a config choice.
3. **No fallback to the contact roster.** A missing/unset hiring recipient
   config fails closed (dev-only or hard error). It NEVER falls back to the
   contact-form fan-out roster - the two purposes stay distinct.
4. **submitterEmail threading.** The applicant's address rides `Reply-To`
   only, never `From`; the app's internal-submitter/livecheck guards compose
   with hiring mail exactly as they do with contact mail.
5. **Envelope validity.** The payload validates against
   `hiring-application/v1` before any mail is constructed; the honeypot is
   consumed before envelope construction.

## 6. Adoption checklist

1. Author (or, once the registry version exists, ingest) the schema per the
   SSOT trajectory (§1). Run `just hiring-application-validate` against your
   copy of the envelope + fixture.
2. Add `<apply-route>`: form markup + `fetch()` POST + the mail-only server
   route, same shape as your contact route. Nothing else enters the app (§3).
3. Add the hiring purpose class to `<mail-choke-point>`; wire
   `<hiring-recipients>` (prod) and `<dev-recipient>` (all nonprod).
4. Land the mail-law amendment + email-law contract-test updates in the SAME
   PR (§3).
5. Pin the five invariants of §5 as contract tests in that same PR.
6. Carry the §4 posture; list any subset you defer as named checklist debt,
   and close it before wider exposure.
7. Verify by configuration and GET/OPTIONS-only checks. **NEVER live-submit
   the form in verification** - a POST delivers real mail to real people.
   Describe the POST test; do not fire it. (Same law as the sibling doc §9,
   for the same reason.)

## 7. Named follow-up debt (nothing below is built now)

- **Dashboard / platform / initiative ingestion** of the
  `hiring-application/v1` envelope. The versioned `envelope` const reserves
  the seam; no ingester, no storage, no workflow exists until ratified
  (operator ruling 2026-07-29; tracked under TIN-2901).
- **`tummycrypt/hiring-form-kit` + bazel-registry registration** (§1 step 2),
  then the first consumer's swap PR (§1 step 3).
- **The resume/file-transport decision** (§1) - decided before v1 freezes.
- **Filling this stub to the full house register** once the first reference
  implementation is live-verified.

## 8. Deliberately out of scope

- Any scaffold-shipped form component, handler, or route code - this doc is
  the parameterized shape and the invariant list only.
- Role copy, posting text, and recipient identities - consumer-side, and the
  client's language verbatim where client-facing.
- The sibling doc's infra plane (Anubis gate, LMTP, NetworkPolicies) - this
  pattern's first consumer delivers through an app it already owns; a static
  spoke wanting hiring intake should start from the sibling doc instead.

## 9. Cross-references

| Ref | What | Where |
| --- | --- | --- |
| [`community-contact-intake.md`](./community-contact-intake.md) | the contact-intake sibling; source of the §4 posture and the never-live-submit law | this repo |
| `docs/schemas/hiring-application.v1.schema.json` | the v1 envelope + fixture + `just hiring-application-validate` | this repo |
| MassageIthaca `src/routes/careers/apply` + `src/lib/server/email.ts` | first reference implementation (in flight): careers form + recipient choke point | `tummycrypt/MassageIthaca` |
| `tummycrypt/hiring-form-kit` | planned SSOT home; versioned via `tinyland-inc/bazel-registry` (TIN-2838 ingestion) | planned |
