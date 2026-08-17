# Public contact form to mailing-list LMTP intake (Anubis-gated, zero-owned supply chain)

A parameterized pattern for accepting a **public contact-form submission** from a
static spoke and delivering it, over **LMTP**, into an in-cluster mailing list
that fans the message out to its members. It is the intake sibling of
[`community-list-and-archive.md`](./community-list-and-archive.md): that doc
stands up the list engine and the on-site *read* surface; this doc covers the
*write* surface (the form -> list path) that the list doc never touches.

It has two planes:

- **Infra plane** (a k8s-backed sister's own repo): an Anubis proof-of-work gate
  fronting a **stdlib-only** Python handler that validates the payload,
  rate-limits it, and injects it over LMTP with **no SMTP credential**; a
  default-deny NetworkPolicy pair that makes the gate un-bypassable; and the same
  fail-closed DNS + dispatch-gated apply lane as the list doc.
- **Site plane** (a static spoke): a plain HTML form whose only moving part is a
  **cross-origin `fetch()` POST** of a small JSON body. No client library, no
  build-time secret, no runtime state. The spoke stays static.

> **Boundary note - this is NOT a scaffold runtime feature.** A static spoke
> stays static / no-DB / no-edge-auth (`AGENTS.md`). The handler, the Anubis
> gate, the NetworkPolicies, and the apply lane belong to a **k8s-backed
> sister's own infra repo**, never to a static spoke. The only piece a spoke
> itself owns is the form markup and the `fetch()` call, which are pure static
> assets and therefore stay inside the static-spoke boundary. The mailing list
> that receives the intake is the same engine documented in the companion list
> pattern; stand that up first.

**Reference implementation.** Everything below is distilled from the
`great-falls-tool-bus-infra` repo (`k8s/form/**`, `k8s/form/README.md`, and
`scripts/validate-form-stack.sh`) and the static spoke that consumes it, cited by
path throughout. Those repos are the worked, live proof; this doc is the
parameterized shape to copy, with the load-bearing decisions and the pitfalls
called out so a second consumer does not re-derive them wrong.

**Parameterize as you copy.** Placeholders below - `<tenant-namespace>`,
`<site-origin>`, `<forms-host>`, `<intake-list>@<domain>`, `<from-addr>@<domain>`,
`<list-core-fqdn>`, `<pod-cidr>`, and every `@sha256:...` digest - are
per-consumer. No reference-repo namespace, hostname, list address, CORS origin,
CIDR, or image digest should survive into your copy except as a citation of the
public reference repos. The transport **ports** (`8081`/`8080`/`8024`) are
load-bearing to the doctrine below and are kept verbatim; retarget them only if
your list engine and gate differ.

---

## 1. Architecture at a glance

```
  ┌─ infra repo (k8s-backed sister) ─────────────────────────────────────────┐
  │                                                                           │
  │  Cloudflare Tunnel ─8081─▶ anubis (PoW gate)                              │
  │  (dashboard/token-managed;   │  ALLOW  /api/contact  (JSON POST)          │
  │   route not in git)          │  CHALLENGE  everything else (browsing)     │
  │                              ▼ 8080 (reverse-proxy solved request)        │
  │                       form-handler  (stdlib-only python:alpine, digest)   │
  │                              │  honeypot · token bucket · CORS · size cap │
  │                              ▼ LMTP 8024 (NO SMTP credential)             │
  │                       list-engine core ──▶ <intake-list>@<domain>         │
  │                                             (accepts non-member post BY   │
  │                                              DESIGN) ──▶ substrate 587     │
  │                                              SASL + DKIM fan-out to members│
  └───────────────────────────────────────────────────────────────────────▲──┘
                                                                            │
  ┌─ site repo (static spoke) ─────────────────────────────────────────┐   │
  │  <form> + fetch('https://<forms-host>/api/contact', {POST, JSON})   │───┘
  │     honeypot input (visually hidden) · one allowed origin           │
  └─────────────────────────────────────────────────────────────────────┘
```

Two facts define the whole design and are easy to get wrong:

1. **The PoW gate cannot protect the POST.** Anubis serves its proof-of-work as
   an HTML/JS interstitial into a *browsing context*. A cross-origin `fetch()`
   receives that challenge as an opaque body it cannot execute, so the JSON route
   **must be `ALLOW`ed** or the form breaks. Anti-abuse for the POST therefore
   lives **inside the handler**, not in the gate (see §3 and the load-bearing
   security section, §9).
2. **The intake needs no credential.** LMTP injection into a list configured to
   accept non-member posts requires no SMTP auth; the authenticated, DKIM-signed
   delivery happens later, on the substrate's 587 fan-out leg. So the stack ships
   **zero Secrets** (§4, §7).

---

## 2. The handler - stdlib only, zero owned supply chain

Reference: `great-falls-tool-bus-infra`
`k8s/form/<tenant-namespace>/configmap-form-handler.yaml` and
`deployment-form-handler.yaml`.

The handler is a single `server.py` written against the **Python standard library
only** (`http.server` for the listener, `smtplib.LMTP` for delivery, `email` for
message construction). It is **mounted read-only from a ConfigMap** onto a
**digest-pinned** upstream `python:<ver>-alpine@sha256:...` image and run with
`command: ["python3", "/app/server.py"]`. There is **no `pip install`, no wheel,
no Dockerfile, and no pushed image of your own** - so the stack owns zero
supply-chain surface beyond the upstream Python it pins. This is the load-bearing
choice that lets a contact form ship without a build pipeline or an image
registry entry.

Posture that makes "code in a ConfigMap" safe at runtime:

- `securityContext`: `runAsNonRoot: true`, a non-zero `runAsUser`,
  `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`,
  `capabilities.drop: ["ALL"]`, `seccompProfile: RuntimeDefault`. Nothing is
  written to disk at runtime, so the read-only FS costs nothing.
- **`replicas: 1` with `strategy: Recreate`.** The rate-limit token bucket (§3)
  is in-memory, so a single replica keeps it coherent. The workload is trivially
  cheap; horizontal scale would require an external rate-limit store, which is
  out of scope for a contact form. Say so in a comment so the next reader does
  not "helpfully" scale it and silently defeat the limiter.
- A `GET /healthz` returning `{"ok": true}` backs the readiness/liveness probes;
  it is CORS-free and side-effect-free.

### Parameters

| Parameter | What it is | Notes |
| --- | --- | --- |
| `<tenant-namespace>` | the tenant k8s namespace | overlay-side; shared with the list stack |
| `<site-origin>` | the one allowed CORS origin | e.g. `https://<site-domain>`; asserted in env **and** code (§3) |
| `<forms-host>` | the tunnel public hostname for the POST | e.g. `forms.<domain>`; route lives Cloudflare-side (§8) |
| `<intake-list>@<domain>` | the list that receives the intake | configured to **accept non-member posts**; fan-out to members is the feature |
| `<from-addr>@<domain>` | the DMARC-aligned `From` identity | domain aligns with the substrate DKIM signer on the 587 leg |
| `<list-core-fqdn>` | the LMTP listener | the list engine core, `mailman-core.<tenant-namespace>.svc.cluster.local` in the reference |
| handler image | `python:<ver>-alpine@sha256:...` | pin by **digest**; the app is the ConfigMap `server.py` |
| gate image | `ghcr.io/techarohq/anubis:vX.Y.Z@sha256:...` | pin by **digest** |

---

## 3. Anti-abuse inside the handler (the POST's only defense)

Because the gate `ALLOW`s the POST (§1, §5), these controls **are** the intake's
protection, not a nicety. Every one is offline-asserted by the validator (§7).

1. **Honeypot with a silent fake-success.** The form carries a decoy field (the
   reference names it `website`) that a real, visually-hidden input leaves empty
   and a naive bot fills. When it is non-empty the handler returns **`200 {"ok":
   true}` and sends nothing** - never a `400`. Tipping the bot that it was
   detected only trains the next attempt.
2. **Per-client token bucket keyed on the trusted edge IP.** A continuous-refill
   in-memory bucket (the reference is 5 requests/minute/client) keyed on
   **`CF-Connecting-IP`**, the header the edge sets before the request enters the
   tunnel. **ANTI-PATTERN, called out explicitly: keying on `X-Forwarded-For` is
   a validator FAILURE.** Any client can forge `X-Forwarded-For`, so trusting it
   lets an attacker mint a fresh bucket per request and erase the limit. Fall
   back to the socket peer address if the trusted header is absent (coarser but
   unspoofable), never to a client-supplied forwarding header. The validator
   greps for and **rejects** any `X-Forwarded-For` read.
3. **CRLF header sanitization.** Every value that reaches a mail header (name,
   address) has `\r` and `\n` stripped before construction, defeating header
   injection (a forged `To`/`Bcc`/extra-header splice) at the source.
4. **CORS locked to exactly one origin, in env AND code.** The allowed origin is
   an env var (`<site-origin>`) **and** the same literal is the code default, so
   a missing/overridden env cannot silently open the endpoint to the world. The
   handler echoes `Access-Control-Allow-Origin` only on an exact `Origin` match,
   sets `Vary: Origin`, and answers the `OPTIONS` preflight for the POST. The
   validator asserts the origin in **both** the deployment env and `server.py`.
5. **Body-size cap.** The request body is capped (the reference is 64 KiB); a
   missing, non-positive, or oversized `Content-Length` is rejected (`413`)
   before any read, so a client cannot exhaust memory.
6. **No authenticated SMTP.** Delivery is `smtplib.LMTP` only (§4). The validator
   **fails** if it finds `smtplib.SMTP` or a `.login(` call - an authenticated
   submission path would both need a credential and change the trust model.

The handler also enforces ordinary input hygiene (JSON-only, strict field
presence and length bounds, a pragmatic address regex) and logs no PII body to
stdout.

---

## 4. The LMTP injection contract (no credential, DMARC-safe)

Reference: the `deliver()` / `build_message()` functions in
`configmap-form-handler.yaml`; the contract header block in that file and
`k8s/form/README.md`.

- **`smtplib.LMTP` to the list engine core, no auth.** The handler dials
  `<list-core-fqdn>:8024` and `sendmail`s the message. The list is configured to
  **accept non-member posts by design** (e.g. Mailman's
  `default_nonmember_action = accept`), so injection needs **no membership and no
  SMTP credential**. This is why the stack carries no Secret (§7).
- **The fan-out, not the injection, is the authenticated leg.** The list engine
  relays outbound to every member over the substrate's certified **587 / SASL +
  DKIM** path. DKIM rides that leg, not the LMTP injection. Keep the two legs
  distinct in your head: the intake is credential-free precisely because the
  trusted, signed delivery happens downstream.
- **DMARC-safe envelope + headers.** `From` is a domain-aligned identity
  (`<from-addr>@<domain>`) so the substrate DKIM signer covers the message;
  `Reply-To` is the visitor's address (so a keyholder can reply to the human, but
  the envelope is never *from* the human); a marker header (the reference uses
  `X-<site>-Form: contact`) and `Auto-Submitted: auto-generated` tag the source.
  The visitor's raw address never becomes the `From`.

> **Do not mint an SMTP credential to "do it properly."** The whole point is that
> a credential-free LMTP inject into a non-member-accepting list is *simpler and
> safer* (nothing to leak) than an authenticated submission. If your list refuses
> non-member posts, fix the list policy; do not add a Secret to the form stack.

---

## 5. The fronting Anubis gate (ALLOW the POST, CHALLENGE the browsing surface)

Reference: `configmap-anubis-policy.yaml`, `deployment-anubis.yaml`,
`service-anubis.yaml`. The Anubis **module** shape (Deployment / ClusterIP /
policy / netpol, digest-pinned, `replicas: 1`, non-root/read-only) is
**site.scaffold #55**; adopt that and do not re-derive it here. What is specific
to intake is the **policy split**:

- **`ALLOW` the JSON POST path, first.** A single rule
  `{"path_regex": "^/api/contact$", "action": "ALLOW"}` is **prepended** to the
  stock policy. A cross-origin `fetch()` POST cannot solve a browser PoW (§1), so
  this route must bypass the challenge; the handler's own controls (§3) are its
  protection.
- **Keep the browsing surface `CHALLENGE`d.** The stock generic-browser rule
  (`user_agent_regex: "Mozilla"` -> `CHALLENGE`) stays intact and **after** the
  ALLOW, so a human pointing a browser at `<forms-host>` is still gated as
  decided, while the site's fetch (which also sends a `Mozilla` UA) matches the
  earlier ALLOW.
- **Order is load-bearing.** Rules evaluate top to bottom, first terminal match
  wins. The `/api/contact` ALLOW **must precede** the browser CHALLENGE or the
  fetch is challenged and the form breaks. The validator asserts
  `allow_index < challenge_index`.
- **Version caveat, stated crisply.** Older Anubis parses the policy as **JSON
  only** and has **no HTTP-method matcher** (`path_regex` matches the URL path
  only), so the ALLOW is path-scoped, not method-scoped. That is acceptable only
  because the handler rejects every method other than `POST`/`OPTIONS` on that
  path and owns its own abuse controls. Confirm your Anubis version's policy
  format and matcher set before copying.
- **Anubis is the only pod the tunnel reaches**, and it reverse-proxies solved
  requests to the handler Service on `8080` (`TARGET=http://form-handler:8080`,
  `BIND=:8081`). The gate is never bypassable at the network layer (§6).

---

## 6. NetworkPolicy doctrine (default-deny, gate un-bypassable, least-privilege egress)

Reference: `k8s/form/<tenant-namespace>/networkpolicy.yaml`.

A default-deny pair enforces the single legal path
`tunnel -> anubis:8081 -> form-handler:8080 -> list-core:8024`:

- **Handler ingress is ONLY from the Anubis pod** (podSelector on the gate,
  port `8080`). The handler is never reachable directly through the tunnel, so
  the PoW gate cannot be skipped at the network layer.
- **Handler egress is least-privilege:** DNS, plus the list-engine core pod on
  `8024` (LMTP) and nothing else. The validator asserts the egress target and
  **fails** on any `0.0.0.0/0`.
- **Anubis ingress is from the tunnel namespace** (namespaceSelector, port
  `8081`); **Anubis egress is only to the handler** on `8080`.
- **Tunnel source selection - a real gotcha.** If the tunnel runs as an ordinary
  (non-host-networked) Deployment, its pods carry CNI pod IPs and cross-namespace
  pod-to-pod traffic preserves the real source, so a **namespaceSelector on the
  tunnel namespace** is the tightest correct admission (no ipBlock needed).
  Documented fallback if a future CNI change SNATs cross-node pod traffic and the
  selector stops matching: widen to an `ipBlock: <pod-cidr>` on the pod CIDR.
  Prefer the namespaceSelector until a live round-trip proves otherwise. (Contrast
  a **host-networked** substrate component, which appears as a node/CIDR source
  and needs the ipBlock form - see the list stack's own netpol.)
- **The reciprocal admission is easy to forget and fails closed.** The list
  engine's own NetworkPolicy is default-deny on ingress; if its `8024` rule only
  admits the host-networked submission source, it will **reject** the handler pod
  and LMTP delivery fails silently. Add the reciprocal rule (list-core accepts
  `8024` from the handler podSelector) to the **list stack's** netpol in the same
  change, and gate it in the pre-apply runbook.

---

## 7. The offline validator (invariants that fail CI before any apply)

Reference: `scripts/validate-form-stack.sh`. Same chassis as the list doc's
per-stack validator (§8): it **never contacts a cluster and never needs a
secret**, so a manifest regression fails CI before an apply can happen. It
asserts:

1. **The handler byte-compiles.** It extracts `server.py` from the ConfigMap and
   runs `python3 -m py_compile`, so a syntax slip in the mounted source is caught
   before the pod ever runs it.
2. **Honeypot present** (`website` field read + the silent-success path).
3. **Token bucket present and keyed correctly** (a `TokenBucket`, keyed on
   `CF-Connecting-IP`) **and the `X-Forwarded-For` anti-pattern is rejected** (a
   grep for a spoofable-header read is a hard failure).
4. **LMTP delivery present** (`smtplib.LMTP`) and **no authenticated SMTP**
   (`smtplib.SMTP` / `.login(` are hard failures).
5. **CORS locked to one origin in env AND code** (the `<site-origin>` literal in
   both the deployment env and `server.py`, plus `Access-Control-Allow-Origin`
   and the `OPTIONS` preflight handler in the source).
6. **Images pinned by digest** (every `image:` carries `@sha256:`; no `:latest`;
   the handler is the pinned upstream Python, the gate the pinned Anubis).
7. **Gate wiring** (`TARGET`/`BIND`, the policy `ALLOW /api/contact` **ordered
   before** the browser `CHALLENGE`, the policy body is valid JSON, the mounted
   policy path matches `POLICY_FNAME`).
8. **NetworkPolicy doctrine** (handler ingress from the gate only; handler egress
   to `8024`, no `0.0.0.0/0`; gate ingress from the tunnel namespace on `8081`;
   gate egress to the handler on `8080`).
9. **Both workloads `runAsNonRoot`.**
10. **No Secret and no committed secret value** (`kind: Secret` is a hard
    failure; a heuristic scan for inline credential values excludes
    `secretKeyRef`/`valueFrom`). Finally, `kubectl kustomize` must render.

This validator is the per-stack member of the reusable stack-lane triple proposed
for upstreaming in **ci-templates #78**; consume that lane when it lands rather
than re-copying the workflow per stack.

---

## 8. Fail-closed DNS + dispatch-gated apply (same doctrine as the list doc §4)

The intake stack is a **declare-only design packet** until an operator flips it
on. The three fail-closed properties are identical to the list doc's §4, applied
to the forms route:

1. **DNS is gated behind a default-false variable.** The public forms DNS record
   is `count = var.<forms-route>_dns_enabled ? 1 : 0` with **`default = false`**
   in the edge stack. Merging the manifests exposes nothing; DNS is a deliberate,
   separate flip after a smoke proof.
2. **The tunnel route is dashboard/token-managed, never in git.** The
   `<forms-host>` -> `anubis:8081` ingress map lives in the Cloudflare zero-trust
   dashboard/API. There is no tunnel-route resource in the repo by design; a
   spoke never holds Cloudflare credentials.
3. **Apply runs through a dispatch-gated GitOps lane, not on PR.** PR/push runs
   are **offline validation only** (§7). Live `server-dry-run`/`apply` is
   `workflow_dispatch` behind a **protected environment** whose namespace-scoped
   kubeconfig is materialized from a secret at dispatch time. The recipe shape
   matches the list doc:

```
just form-stack-validate          # offline; the CI gate (§7)
just form-stack-server-dry-run    # kubectl apply --dry-run=server -k <dir>   (dispatch, protected env)
just form-stack-apply             # kubectl apply -k <dir>                     (dispatch, protected env)
```

---

## 9. Load-bearing security section (READ BEFORE ANY PUBLIC EXPOSURE)

This is not advisory. The intake **delivers real mail to a private list with no
proof-of-work in front of the POST**, so the posture below is mandatory, not
optional hardening.

- **The POST endpoint has no PoW by design.** Anubis `ALLOW`s `/api/contact`
  because a cross-origin `fetch()` cannot solve a browser challenge (§1, §5).
  That is the correct, documented tradeoff - **do not "fix" it by removing the
  ALLOW**, which only breaks the form. It also means the endpoint is publicly
  POST-able and delivers straight to `<intake-list>@<domain>`.
- **The handler's anti-abuse posture is the whole defense and is mandatory.** The
  honeypot, the `CF-Connecting-IP` token bucket (never `X-Forwarded-For`), the
  one-origin CORS, the CRLF sanitization, and the body cap (§3) are the only
  things standing between the open POST and the list. Shipping the endpoint
  without all of them is shipping an open mail relay into a private list.
- **Altcha + honeypot is the required hardening before any Access-off public
  exposure.** The honeypot is beaten by any real form parser and the per-IP
  bucket is beaten by IP rotation with no global ceiling, so before the endpoint
  is exposed **without** an upstream Access gate, add a self-hosted
  proof-of-work captcha (Altcha: MIT, privacy-first, and re-implementable in the
  Python **stdlib only** so it preserves the zero-owned-supply-chain invariant -
  the client solves a challenge and includes the payload in the JSON POST; the
  handler verifies before injecting). Pair it with the honeypot; add an HMAC
  time-trap and a global aggregate ceiling alongside the per-IP bucket. Until
  that lands, keep the surface gated (upstream Access on, DNS flag off, endpoint
  unadvertised).
- **Verification must NEVER live-submit the form.** A `POST` to this endpoint
  delivers mail to real people. Verify it by **configuration and GET-only
  challenge checks** (the offline validator §7, a `GET` that should be
  challenged, an `OPTIONS` preflight), and **describe** the POST test rather than
  firing it. Any brief that exercises a mail-delivering or otherwise
  side-effecting endpoint must carry an explicit no-live-submit rule. This
  paragraph exists because a live probe once delivered test messages into the
  operator's inbox; do not repeat it.

---

## 10. What the pattern standardizes vs what stays consumer-side

**Standardized (copy the shape + the reasons):** the stdlib-only,
ConfigMap-mounted handler on a digest-pinned upstream image (zero owned supply
chain); the in-handler anti-abuse posture of §3 (honeypot silent-success, the
`CF-Connecting-IP` token bucket with the `X-Forwarded-For` failure called out,
CRLF sanitization, one-origin CORS in env and code, body cap, no authenticated
SMTP); the credential-free LMTP contract (§4); the Anubis policy split
(ALLOW-the-POST / CHALLENGE-the-browsing-surface, ordered) on top of the #55
module; the default-deny netpol pair and the reciprocal-admission gotcha (§6);
the offline validator invariants (§7); the fail-closed DNS + dispatch-apply lane
(§8); and - non-negotiably - the security posture of §9.

**Consumer-side (yours to own):** the list address and namespace; the exact CORS
origin and forms hostname; the tunnel public-hostname route (dashboard); the
brand skin and copy of the form; the Anubis difficulty and the rest of its bot
list; and the operator go-live ordering for your environment.

---

## 11. Cross-references

| Ref | What | Where |
| --- | --- | --- |
| [`community-list-and-archive.md`](./community-list-and-archive.md) | the list engine + on-site archive this intake writes into (stand up first) | this repo |
| [`multi-agent-orchestration.md`](./multi-agent-orchestration.md) | the working method that delivered the capstone this pattern is distilled from | this repo |
| site.scaffold **#55** | Anubis PoW gate module (this pattern's §5 fronting gate) | `tinyland-inc/site.scaffold` |
| site.scaffold **#56** | preview/live fail-closed flag idiom (the site-plane form's visibility gate) | `tinyland-inc/site.scaffold` |
| ci-templates **#78** | reusable k8s-stack lane (validate / dry-run / apply) - this pattern's §7/§8 chassis | `tinyland-inc/ci-templates` |

**Reference implementation pointers:**

- Handler + gate manifests + validator: `great-falls-tool-bus-infra`
  `k8s/form/<tenant-namespace>/**`, `k8s/form/README.md`,
  `scripts/validate-form-stack.sh` (contact-intake stack).
- List engine + LMTP listener the intake targets: the companion list stack
  (`k8s/list/<tenant-namespace>/**`) documented in
  [`community-list-and-archive.md`](./community-list-and-archive.md).
- Anubis policy rationale (challenge-vs-fetch evidence) and the captcha /
  bot-mitigation decision brief live in the infra repo's runbooks and research
  docs; the hardening plan is the Altcha follow-up cited in §9.

---

## 12. Adoption checklist

1. Stand up the **list stack** first ([`community-list-and-archive.md`](./community-list-and-archive.md)),
   with the intake list set to accept non-member posts. Confirm its LMTP listener
   answers on `8024`.
2. Add the **handler** (§2): stdlib `server.py` in a ConfigMap, mounted read-only
   onto the digest-pinned Python image, non-root / read-only FS, single replica.
3. Wire the **anti-abuse posture** (§3) and the **LMTP contract** (§4). No Secret.
4. Add the **Anubis gate** (§5, #55) with the ALLOW-the-POST / CHALLENGE-the-rest
   policy split, ALLOW ordered first.
5. Add the **default-deny netpol pair** (§6) - and the **reciprocal admission**
   on the list stack, or LMTP fails closed.
6. Gate CI on the **offline validator** (§7). It passes with no cluster and no
   secret.
7. Keep everything **declare-only / flags-off**: `<forms-route>_dns_enabled =
   false`, no tunnel route.
8. Go-live, **in order**: offline validate -> dispatch dry-run -> dispatch apply
   -> add the tunnel public-hostname route (dashboard) -> `<forms-route>_dns_enabled
   = true`. **Do the §9 hardening (Altcha) before removing any upstream Access
   gate.** Verify by config and GET-only checks; **never live-submit** (§9).

---

## 13. Deliberately out of scope

- The deployable k8s template and any scaffold-shipped handler code - a separate
  backlog ticket. This doc is the parameterized shape only.
- Concrete manifests, tunnel ids, list names, DKIM/secret material - those live
  in the cited infra repo, operator-owned.
- The Anubis module detail (#55) and the site-plane visibility flag idiom (#56) -
  adopted by reference, not restated.
- The full Altcha implementation - the §9 hardening is specified as a
  requirement and a follow-up, not built here.
