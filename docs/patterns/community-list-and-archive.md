# Community mailing-list + on-site archive (opt-in, k8s-backed)

A parameterized pattern for standing up a **public community mailing list** with
a **privacy-safe, on-site readable archive**. It has two planes:

- **Infra plane** (a k8s-backed sister's own repo): GNU Mailman 3 (core +
  Postorius + HyperKitty), an Anubis proof-of-work anti-scrape gate, and a
  fail-closed tunnel/DNS enable sequence applied through a dispatch-gated
  GitOps lane.
- **Site plane** (a SvelteKit spoke): a **server-only** headless fetch of the
  HyperKitty REST API that maps threads into a small, privacy-gated snapshot
  contract, rendered as an on-site thread index and a full on-site thread
  reader.

> **Boundary note — this is NOT a scaffold runtime feature.** A static spoke
> stays static/no-DB/no-edge-auth (`AGENTS.md`). The Mailman stack, the Anubis
> gate, and the tunnel/DNS lane belong to a **k8s-backed sister's own infra
> repo**, never to a static spoke. The only piece a spoke itself runs is the
> **build-time** archive fetch (below), which prerenders to a static `build/`
> and therefore stays inside the static-spoke boundary. The post-cutover
> adapter-node SSR form of that same fetch is a **dynamic-spoke** option (see
> `docs/decisions/dynamic-spoke-adapter-mode.md`), not a static-spoke one.

**Reference implementation.** Everything below is distilled from the
`Great-Falls-Tool-Bus/greatfallstoolbus.org` (site) and
`Great-Falls-Tool-Bus/great-falls-tool-bus-infra` (infra) repos, cited by path
and PR throughout. Those repos are the worked, live proof; this doc is the
parameterized shape to copy, with the load-bearing decisions and the pitfalls
called out so a second consumer does not re-derive them wrong.

**Parameterize as you copy.** Placeholders below — `<list>@<domain>`,
`lists.<domain>`, `<tenant-namespace>`, `<site-namespace>` — are per-consumer.
No reference-repo namespace, hostname, or tunnel id should survive into your
copy except as a citation of the public reference repos.

**Companion pattern - the write path.** This doc covers the list engine and the
on-site *read* archive. The public contact **form to list** intake (an
Anubis-gated, credential-free LMTP inject that a form POST delivers into this
list) is its sibling,
[`community-contact-intake.md`](./community-contact-intake.md).

---

## 1. Architecture at a glance

```
  ┌─ infra repo (k8s-backed sister) ───────────────────────────────────┐
  │                                                                     │
  │  substrate postfix ──LMTP:8024──▶ mailman-core ─┐                   │
  │                                                 │ loopback POST     │
  │                                   (same pod)    ▼ 127.0.0.1:8000    │
  │                                   mailman-web (Postorius+HyperKitty)│
  │                                        ▲                            │
  │  Cloudflare Tunnel ─8081─▶ anubis-archive (PoW) ─8000─┘ (post-DNAT) │
  │  (dashboard-managed;   (declare-only until go-live; DNS fail-closed)│
  │   token, not in git)                                                │
  └─────────────────────────────────────────────────────────────────▲──┘
                                                                      │
                    in-cluster Service DNS (mailman-web ClusterIP)    │ REST
  ┌─ site repo (SvelteKit spoke) ──────────────────────────────────┐  │
  │  $lib/server/*-archive.ts  ── build-time (adapter-static) ──────┼──┘
  │     fetch → map → sanitize → PRIVACY GATE → snapshot contract   │
  │  routes/<board>/+page.server.ts  → index (hairline rows)        │
  │  routes/<board>/[thread]/+page.server.ts → on-site reader       │
  └────────────────────────────────────────────────────────────────┘
```

Two independent gates protect two different things: **Anubis** taxes bulk bots
on an intentionally-public surface (anti-scrape, *not* auth); the **per-list
`archive_policy`** in Mailman core is the real privacy control. Keep them
distinct in your head — conflating them is the most dangerous mistake here.

---

## 2. Infra plane — the Mailman 3 stack (list engine)

Reference: `great-falls-tool-bus-infra` `k8s/list/<tenant-namespace>/**`
(PR #62), `k8s/list/README.md`.

### Co-location rationale (the load-bearing decision)

Run **mailman-core and mailman-web as two containers in ONE pod**, not two
Deployments. HyperKitty archives a message only when the core's archive `POST`
arrives from a *trusted* source IP (`MAILMAN_ARCHIVER_FROM`, which
`django-mailman3` derives from `MAILMAN_HOST_IP`). Co-location lets core POST
the archive over **loopback** (`HYPERKITTY_URL → http://127.0.0.1:8000/hyperkitty`)
and you pin `MAILMAN_HOST_IP=127.0.0.1`, so the same-pod POST is trusted. This
is the `maxking/docker-mailman` image's native single-host assumption. The
earlier two-Deployment shape — POST arriving from the dynamic core **pod** IP —
made HyperKitty answer **403** and silently archive nothing.

> Reference commentary: `k8s/list/<tenant-namespace>/deployment-mailman-core.yaml`
> header block and the `mailman-web` container `env` (TIN-2493).

### GOTCHA 1 — uwsgi `--static-map` (the "bare-text archive" trap)

The stock `docker-mailman` `uwsgi.ini` ships **no static-map**: it assumes a
fronting webserver serves `/static` from the shared volume. In this topology
Anubis proxies **straight to uwsgi:8000** with no such fronting server, so
`/static/**` falls through to Django and 404s — the public archive renders as
**bare unstyled text**. Fix by overriding the web container's `args` (CMD only;
the entrypoint's `docker-entrypoint.sh` setup still runs) to add the map:

```yaml
args:
  - uwsgi
  - --ini
  - /opt/mailman-web/uwsgi.ini
  - --static-map
  - /static=/opt/mailman-web-data/static   # collectstatic output dir
```

### GOTCHA 2 — `DJANGO_ALLOWED_HOSTS` must carry the Service FQDN (the 400 trap)

Django's HyperKitty rejects any request whose `Host` header is not in
`ALLOWED_HOSTS` with a bare **HTTP 400**. In-cluster REST consumers (the site's
build-time fetch, below) must dial the **Service FQDN**
`mailman-web.<tenant-namespace>.svc.cluster.local` — but the image's default
`ALLOWED_HOSTS` carries only the short `mailman-web`. Result:
`Host: mailman-web → 200`, `Host: <FQDN> → 400`, and every build silently
degrades to the empty fallback. **Add the FQDN explicitly:**

```yaml
- name: DJANGO_ALLOWED_HOSTS
  value: "127.0.0.1,mailman-web.<tenant-namespace>.svc.cluster.local"
```

There are two independent ways to satisfy this trap; the reference uses **both**
(belt-and-braces): the manifest above, *and* the consumer-side
`clusterHostHeader` override (see §5). If you can only do one, do the manifest.

### GOTCHA 3 — verified STARTTLS to the substrate MTA (fail-closed, private-CA)

Both mailman containers (core **and** web) must dial the in-cluster submission
endpoint over **verified** STARTTLS, not opportunistic. Set on both:

```yaml
- name: SMTP_VERIFY_HOSTNAME
  value: "True"
- name: SMTP_VERIFY_CERT
  value: "True"
- name: SSL_CERT_FILE
  value: /etc/ssl/<mail-substrate-ca>/ca.crt   # mounted from a Secret
```

Four load-bearing facts, each a place a naive copy leaks or breaks:

- **The trust anchor is a private root, NOT the public wildcard.** The in-cluster
  `postfix.<substrate-ns>.svc…:587` leaf is signed by an **operator-owned private
  CA**, not the Let's-Encrypt wildcard that fronts the public site. `SSL_CERT_FILE`
  points at that private-CA bundle, mounted from a Secret (parameterize the name,
  e.g. `<mail-substrate-ca>`). Pointing it at the public chain will **not** verify
  an internal leaf.
- **The leaf SAN must cover the exact FQDN dialed.** Verification checks the
  hostname, so the `:587` leaf's SAN has to include the precise in-cluster Service
  FQDN the mailman containers use — not a public MX name, not a short label. A SAN
  that omits the dialed FQDN fails the handshake.
- **Absent Secret ⇒ the pod fails closed.** If the CA Secret is not present the
  mount is missing and the container cannot start — delivery stops rather than
  silently downgrading to plaintext. This is a **substrate pre-apply gate**: the
  substrate CA Secret must exist before the list stack applies.
- **The offline validator forbids TLS regressions.** The `list`-stack validator
  hard-fails on any reintroduction of `InsecureTLSEmailBackend`, `CERT_NONE`, or
  `check_hostname=False` **anywhere the settings are assembled** — including
  indirectly through the branding overlay ConfigMap (below). A brand edit must not
  be able to smuggle verification off.

> Reference: `great-falls-tool-bus-infra` `k8s/list/**` deployment `env` +
> `scripts/validate-list-stack.sh` (verified STARTTLS uplift, issue #74).

### Other load-bearing bits (copy the reasons, not just the lines)

- **`DATABASE_CLASS` override on core.** The shared `mailman-env` sets
  `django.db.backends.postgresql` (correct for the web tier, wrong for core,
  which uses SQLAlchemy). Override on the core container to
  `mailman.database.postgresql.PostgreSQLDatabase` or core crashes with
  `ModuleNotFoundError: No module named 'django'`.
- **`MAILMAN_REST_URL` targets the pod IP, not the Service.** Core binds REST to
  the pod IP; the Service hairpin is broken under `rke2-canal`/flannel
  (hairpin-mode off — SYNs to self never return, wedging every uwsgi worker).
  Same pod netns, so dial the pod IP via the downward API
  (`MAILMAN_REST_URL=http://$(POD_IP):8001`). Verify whether *your* CNI hairpins
  before copying a Service-DNS REST URL.
- **`archive_policy` is the privacy control.** Per-list in Mailman core:
  `<private-list>@ = private`, `<public-list>@ = public`. HyperKitty enforces it
  for anonymous users. One HyperKitty instance serves **both** lists path-based
  at the same host — so exposing the public route exposes the web tier that also
  serves the private archive. That is why the go-live privacy pre-flight is a
  **hard gate** (§7), not a nicety.

### Light branding overlay — skin the stock image without forking it

Brand the archive without maintaining a fork of the upstream web image. The
stock image's `settings.py` ends with `from settings_local import *`, so a
mounted **`settings_local.py`** on `PYTHONPATH` is a *supported* extension point,
not a patch. Three moves, all data-only:

- **Template override via prepend.** `settings_local.py` **prepends** your
  override directory to the template `DIRS`, so your `headers.html` / `top.html` /
  `bottom.html` win over the packaged templates (first match serves).
- **A second `--static-map` for the brand stylesheet**, added alongside the
  collectstatic map from GOTCHA 1 (`/static=…` stays; the brand map is additive).
- **`collectstatic` is untouched** — no image rebuild, no fork to rebase on each
  upstream bump. The whole overlay ships as a ConfigMap of files.

That ConfigMap is exactly the surface GOTCHA 3's validator also scans: the
branding lane can add markup and CSS but **cannot** flip TLS verification off.

> Reference: `great-falls-tool-bus-infra` `k8s/list/**` branding ConfigMap +
> `--static-map` args (light branding overlay, TIN-2561).

### Parameters

| Parameter | Reference value | Notes |
| --- | --- | --- |
| `<tenant-namespace>` | `latoolb-us-production` | tenant list-engine namespace |
| `<public-list>@<domain>` | `discuss@latoolb.us` | the one public, indexable list |
| `<private-list>@<domain>` | *(never named on the public surface)* | `archive_policy: private` |
| image pins | `maxking/mailman-core:0.5@sha256:…`, `maxking/mailman-web:0.5@sha256:…` | pin by **digest**; confirm 3.3.x line |
| outgoing MTA | `postfix.<substrate-ns>.svc…:587` STARTTLS+SASL | tenant submission identity |

---

## 3. Infra plane — Anubis PoW gate

**This is scaffold issue #55** ("Anubis PoW gate module: digest-pinned
deployment + ClusterIP + botPolicies + NetworkPolicy pair") — **still open**. Do
not re-derive it here — adopt that pattern when it lands. Two things this umbrella depends on from it:

- **The post-DNAT NetworkPolicy egress trap.** The `mailman-web` Service is
  `ClusterIP 8080 → targetPort 8000` and selects the co-located `mailman-core`
  pod. NetworkPolicy egress evaluates the **post-DNAT** destination — the real
  pod IP and port **8000** — **not** the Service's 8080. So the gate's egress
  rule targets the `mailman-core` podSelector on **8000**, even though Anubis
  dials `http://mailman-web:8080`. (Contrast a forms gate whose Service port and
  targetPort are both 8080 → its egress reads 8080.) See
  `k8s/archive/<tenant-namespace>/networkpolicy.yaml` (archive-stack, PR #59).
- **The archive bot policy differs from a forms policy.** No `/api/*` ALLOW
  carve-out (a pure browsing surface challenges every human browser); plus a
  **prepended** anti-bulk-export `CHALLENGE` on HyperKitty's mbox export path
  (`/export/.*\.mbox(\.gz)?$`), placed **before** the crawler ALLOWs so even an
  allowlisted crawler must solve a PoW to bulk-pull the archive. See
  `k8s/archive/<tenant-namespace>/configmap-anubis-policy.yaml`.

Digest-pin the image (`ghcr.io/techarohq/anubis:vX.Y.Z@sha256:…`), `replicas: 1`
(ephemeral ed25519 signing key regenerates on restart — acceptable only at
replica 1), full non-root/read-only/`drop:[ALL]` posture. The ClusterIP Service
is **the only component the tunnel reaches** for this route.

### Network-enforced PoW — make the gate the ONLY origin path

A PoW challenge only means something if traffic **cannot** route around it. Close
the bypass at the network layer: **remove the tunnel namespace from any ingress
rule on the archive origin's `:8000`**, so the sole admitted public path becomes
`tunnel → anubis → core:8000`. The tunnel reaches Anubis; only Anubis reaches the
origin.

Enforce it with a **separate, additive, reciprocal NetworkPolicy that lives in the
archive stack** — self-contained, with **no edit to the list stack's** own policy,
so the two stacks stay independently ownable and the gate is not silently defeated
by a list-side change. The offline `archive`-stack validator asserts the tunnel
namespace **never reappears** as an admitted source on the `:8000` rule (that
regression would re-open the bypass).

> Reference: `great-falls-tool-bus-infra` `k8s/archive/**` networkpolicy +
> `scripts/validate-archive-stack.sh` (network-enforced PoW gate, PR #77).

### Host-networked substrate MTA — the SNAT asymmetry (how to author the netpol)

When the substrate postfix runs **host-networked**, its two legs need *different*
NetworkPolicy idioms, and picking the wrong one fails closed on the wrong leg:

- **Ingress (LMTP delivery leg):** a host-networked source is **SNAT'd to the node
  CIDR**, so the pod sees a node IP, never a pod IP. Admit it by **`ipBlock`** (the
  node CIDR) — `podSelector`/`namespaceSelector` can **never** match a
  host-networked source.
- **Egress (submission leg to `:587`):** the pod dials the **raw `hostIP`**, and
  that destination is **not** SNAT'd. Admit egress to the host's **`/32`** by
  `ipBlock`.
- **The tunnel is a normal pod:** admit it by **`namespaceSelector`**, never
  `ipBlock` — its address is ephemeral pod IP space.
- **Intra-pod loopback REST** (core ↔ web over `127.0.0.1`, §2) is **invisible to
  NetworkPolicy** — same netns, so no rule is needed for it and none can express it.

Parameterize the node CIDR and the host `/32`; never inline a literal address.

> Reference: `great-falls-tool-bus-infra` `k8s/list/**` + `k8s/archive/**`
> networkpolicy comments (host-networked SNAT asymmetry).

### Read-path exemption + AI-scraper DENY — the bot-policy ordering

The archive's **public** read surface is *also served ungated on-site* (the
SvelteKit reader, §§5–6). A PoW interstitial in front of the same content therefore
buys only friction, not privacy — so exempt the read path, but scope it so it can
**never** touch the private list. Order the bot policy exactly (this refines the
mbox trap above):

1. **mbox `/export…` CHALLENGE stays first** — bulk-pull always pays PoW, even an
   allowlisted crawler.
2. **Read-path ALLOWs:** the public list overview, thread permalinks, and
   `/static/*` — path-scoped so **no rule can match the private list's routes**
   (the `archive`-stack validator guards this; the exemption must not widen to the
   private archive, §7 invariant 1).
3. **Curated AI-scraper DENY block** (parameterize the UA list — e.g. GPTBot /
   ClaudeBot / CCBot / Bytespider / Perplexity / HeadlessChrome), placed **after**
   the read-path ALLOWs and **before** the generic CHALLENGE, with **search
   indexers still ALLOWed** — deny the trainers, keep discoverability.
4. **Generic CHALLENGE** for everything else.

The validator asserts (i) the export CHALLENGE is ordered first, (ii) no read-path
ALLOW matches the private list, and (iii) the DENY block sits after the read ALLOWs
and before the generic CHALLENGE.

> Reference: `great-falls-tool-bus-infra` `k8s/archive/**`
> configmap-anubis-policy + `scripts/validate-archive-stack.sh` (read-path
> exemption + scraper DENY, TIN-2559).

---

## 4. Infra plane — fail-closed tunnel/DNS enable-flag + dispatch-apply doctrine

The archive stack is a **declare-only design packet** until an operator flips it
on. Three properties make the exposure fail-closed:

1. **DNS is gated behind a default-false variable.** The public archive DNS
   record is `count = var.<route>_dns_enabled ? 1 : 0` with **`default = false`**
   in the edge Tofu stack (reference: `tofu/stacks/edge/main.tf`, `README.md`
   "archives DNS enable sequence"). Merging the manifests exposes nothing; DNS
   is a deliberate, separate flip. (Contrast `mail_dns_enabled`/`forms_dns_enabled`,
   which default true *only after* their own smoke proofs closed.)
2. **The tunnel route is dashboard/token-managed, never in git.** The
   public-hostname → `anubis-<route>:8081` ingress map lives in the Cloudflare
   zero-trust dashboard/API. There is no tunnel-route resource in the repo by
   design. A spoke never holds Cloudflare credentials.
3. **Apply runs through a dispatch-gated GitOps lane, not on PR.** PR/push runs
   are **offline validation only**. Live `server-dry-run`/`apply` is
   `workflow_dispatch` behind a **protected environment** whose namespace-scoped
   kubeconfig is materialized from a secret at dispatch time (reference:
   `.github/workflows/archive-stack.yml`, `environment: mail`; PR #59).

**The stack-lane triple** — one workflow + one Justfile recipe set + one
offline validator per stack (`form`/`list`/`mail`/`web`/`archive`) — is the
reusable chassis. Each validator asserts the load-bearing invariants (images
digest-pinned, `TARGET`/`BIND` correct, policy is valid JSON, the netpol
targets the right post-DNAT port) so a manifest regression fails CI **before**
any apply, and never contacts a cluster or needs a secret. The recipe shape:

```
just <stack>-validate          # offline; the CI gate
just <stack>-server-dry-run    # kubectl apply --dry-run=server -k <dir>   (dispatch, protected env)
just <stack>-apply             # kubectl apply -k <dir>                     (dispatch, protected env)
```

This triple is proposed for upstreaming as a reusable lane in **ci-templates
#78** ("Reusable k8s-stack lane") — **still open**. Consume that when it lands
rather than re-copying the workflow per stack.

---

## 5. Site plane — the headless-archive data plane (server-only)

Reference: `greatfallstoolbus.org` `src/lib/server/discuss-archive.ts` and
`src/lib/data/discuss-snapshot.ts` (PRs #113/#114/#117).

- **Server-only module.** Live in `$lib/server/**` so the in-cluster origin and
  the raw HyperKitty responses **never** reach a browser bundle. The UI-facing
  snapshot contract (`$lib/data/*-snapshot.ts`) is the single canonical type; the
  server module consumes and re-exports it — one source of truth.
- **Where it runs / the prerender-vs-SSR swap.** With `prerender = true` the
  route fetches at **build time** on an in-cluster runner (reaches the HyperKitty
  web tier over Service DNS; netpol admits the runner + site namespaces) and
  bakes a static index — this is the **static-spoke-safe** form. Flipping
  `prerender` off under adapter-node makes it a **per-request SSR** read with
  **zero other changes** — a deliberate operator step, the dynamic-spoke form.
- **Origin + the ALLOWED_HOSTS companion.** Default origin is the in-cluster
  Service DNS (`http://mailman-web.<tenant-namespace>.svc.cluster.local:8080`),
  overridable via a private env var. Because that FQDN trips the Django
  ALLOWED_HOSTS trap (§2 GOTCHA 2), the module sends the FQDN's **first DNS label**
  as an explicit `Host` header **only** when the origin is a `*.svc.cluster.local`
  address (`clusterHostHeader()`); an overridden origin (port-forward, public
  host, IP) is left alone.
- **The two swap idioms, named exactly.** The build-time-vs-SSR switch is one
  line in the route module — `export const prerender = process.env.ADAPTER !== 'node'`
  — so static adapters prerender and adapter-node serves per-request with **no
  other change**. The archive origin override is read from **`$env/dynamic/private`**
  (a *runtime* private var — never `$env/static`, so it neither bakes into the
  client bundle nor freezes into the static build), defaulting to the in-cluster
  Service DNS above. Those two idioms are the whole static⇄dynamic seam.
- **Two failure disciplines, on purpose:**
  - The **index** fetch **NEVER throws**: any transport/shape/privacy failure logs
    a loud warning and returns the caller's fallback (default: a valid **empty
    snapshot**). Off-cluster builds (local dev, fork CI) therefore succeed and
    render the honest empty state — **never invented content**. The `[thread]`
    `entries` generator yields `[]` from that empty snapshot, so no thread pages
    prerender off-cluster and the build cannot fail.
  - The **single-thread** reader fetch **THROWS** on any failure; the reader's
    `+page.server.ts` catches it and renders a **calm "unavailable" state**
    (`detail: null`) — never a hard 500, never invented content.
- **Deep links are reconstructed, never echoed.** Build every outbound archive
  URL from a public base (`https://lists.<domain>/hyperkitty/list/<list>/…`) plus
  ids you control; **never** reuse the API's own `url` fields (they carry the
  internal request host). The privacy gate asserts every thread `url` is anchored
  to that public base.
- **Snapshot contract + time helpers** (`*-snapshot.ts`): thread index metadata
  (subject / timestamps / reply+participant counts / `starterName` / excerpt),
  the reader's `DiscussThreadDetail` (quotation-aware `{quoteLevel, text}` body
  blocks), `sortByLastActiveDesc`, and `relativeTime`/`formatTimestamp` built on
  `Intl.RelativeTimeFormat` — **no new deps**.

---

## 6. Site plane — the SvelteKit surface

Reference: `src/lib/components/DiscussThreads.svelte`, `src/routes/<board>/**`
incl. `[thread]/` (PRs #112/#117).

- **Index = hairline rows, never a card grid.** Each thread is a
  `border-t`-separated row: subject (links **internally** to the on-site reader,
  derived from `threadId`) → one plain meta string → optional excerpt. Long
  subjects `break-words` (never truncate); a missing excerpt omits the line; zero
  threads is a **calm empty state**, not an error.
- **On-site thread reader.** Renders the full conversation on-site so a reader is
  never dumped into unstyled HyperKitty/Postorius. Messages are hairline-divided,
  oldest-first. Quotation depth renders via **indentation + muted ink — never a
  side-stripe border-left** (house canon); indent is capped so deep nesting stays
  375px-safe. A single secondary "View on the mailing-list archive" outbound link
  (built from the reconstructed public URL) sits in the footer.
- **`archiveVisible` gating.** The board page **always exists and always explains
  what the list is**; only the archive section + outbound link gate on the
  fail-closed `visible = live || preview` predicate. This dual-flag idiom is
  **scaffold issue #56** ("Fail-closed preview/live feature-flag idiom") — **still
  open**; adopt it when it lands, do not restate the flags here. Its CI companion
  (per-branch flag wiring) is **ci-templates #79** (`build_env` input) — **still
  open**.

---

## 7. Privacy invariants (FIRST-CLASS — the reason this is worth scaffolding)

These are hard, tested invariants, not guidelines. The reference enforces every
one in `assertSnapshotIsPublicSafe` / `assertThreadDetailIsPublicSafe` and their
unit tests (`discuss-archive.test.ts`). A consumer that adopts the surface but
weakens these has built a leak.

1. **The private list is never exposed or named.** Exactly **one** list address
   is allowed to be sourced, rendered, or linked. The gate hard-fails on any
   `keyholders`-class token (parameterize to your private list name) anywhere in
   the serialized payload. The public board copy speaks only about the public
   list; the private role list and its archive are a separate, closed path,
   never linked or named.
2. **Display names only — never an address.** HyperKitty puts a **raw email
   address** into the `sender_name`/`name` field when a message carries no
   display name (**observed live**, not theoretical). `safeDisplayName()` reduces
   any address to a human label (title-cased local part, or "Anonymous"); a real
   display name passes through. No address ever reaches the payload as a name.
3. **The obfuscated-address trap.** HyperKitty obfuscates `@` as **` (a) `**
   (older builds ` (at) `) inside `sender_name` and inline body text. Treat all
   three forms (` (a) `, ` (at) `, raw `@`) as an address. Inline body addresses
   are **neutralized** to `local@…` (the public list address is the one exemption);
   the gate then hard-fails if any ` (a) `/` (at) ` marker or any raw `@` (other
   than the allowed list address and the neutralized `@…` sentinel) survives.
4. **Serialized-payload gate, fail-closed to a calm state.** Privacy is checked
   on the **`JSON.stringify` of the whole payload** (not field-by-field, so a leak
   in an unexpected field is still caught): remove the allowed list address, then
   assert no obfuscated marker, no residual raw `@`, and no other list id remains.
   Any breach **throws** — which the index turns into the empty fallback and the
   reader turns into the calm "unavailable" state. A leak is **fail-closed and
   total, never a partial/leaky payload**.
5. **Structure + anchor validation before trust.** ISO-8601 timestamps, non-empty
   ids/subjects/names, non-negative counts, thread cap, and every thread `url`
   anchored to the public archive base — all asserted before the payload is
   trusted or shipped.
6. **The gate is not the whole story — the pre-flight is.** Because one
   HyperKitty instance serves both the public and private archives at the same
   host, exposing the route exposes the web tier serving both. The go-live
   **privacy pre-flight is a hard gate** ordered *before* DNS enable and the
   tunnel route (§4). Anubis is anti-scrape; `archive_policy` is the control; the
   payload gate is the site-side backstop. All three, in that order.

---

## 8. What the pattern standardizes vs what stays consumer-side

**Standardized (copy the shape + the reasons):** the co-location topology and
its three env gotchas; the Anubis Deployment/Service/policy/netpol shape (#55);
the fail-closed DNS + dashboard-tunnel + dispatch-apply doctrine; the
server-only fetch discipline (never-throw index / throw-and-calm reader,
`clusterHostHeader`, reconstructed deep links); the snapshot contract; the
hairline index + on-site reader UX; and — non-negotiably — the privacy
invariants of §7.

**Consumer-side (yours to own):** the list address(es) and namespace; the
Anubis `botPolicies` rule list; the tunnel public-hostname route (dashboard);
the brand skin of the board/reader; and the operator go-live checklist ordering
for your environment.

---

## 9. Cross-references

| Ref | What | Where | Status |
| --- | --- | --- | --- |
| [`community-contact-intake.md`](./community-contact-intake.md) | the public contact form to list intake (write path) that feeds this list | this repo | companion |
| site.scaffold **#55** | Anubis PoW gate module (this pattern's §3) | `tinyland-inc/site.scaffold` | **still open** |
| site.scaffold **#56** | Preview/live fail-closed flag idiom (this pattern's §6 gating) | `tinyland-inc/site.scaffold` | **still open** |
| ci-templates **#78** | Reusable k8s-stack lane (validate/dry-run/apply) — this pattern's §4 chassis | `tinyland-inc/ci-templates` | **still open** |
| ci-templates **#79** | `build_env` input for cloudflare-pages — #56's CI companion | `tinyland-inc/ci-templates` | **still open** |
| GloriousFlywheel **#1038** | nix2container OCI-image pattern (build the Anubis/site image) — complementary | `tinyland-inc/GloriousFlywheel` | reference |

**Reference implementation pointers (GFTB):**

- Site data plane: `greatfallstoolbus.org` `src/lib/server/discuss-archive.ts`,
  `src/lib/data/discuss-snapshot.ts` (PRs #113/#114/#117).
- Site surface: `src/lib/components/DiscussThreads.svelte`,
  `src/routes/discuss/**` incl. `[thread]/` (PRs #112/#117); flags idiom
  `src/lib/flags.ts` (PRs #89/#95).
- Dual-adapter health probe: `src/routes/health/+server.ts`; build-time
  `PUBLIC_*` bake in the container-image Justfile recipes (PR #111).
- Infra list stack: `great-falls-tool-bus-infra`
  `k8s/list/latoolb-us-production/**` (co-location, static-map, ALLOWED_HOSTS;
  PR #62).
- Infra archive gate + lane: `k8s/archive/latoolb-us-production/**`,
  `.github/workflows/archive-stack.yml`, `scripts/validate-archive-stack.sh`
  (archive-stack, PR #59); DNS fail-closed flag `tofu/stacks/edge/main.tf`.

**Post-doc drift pointers (this refresh):** cited by path only; no literal
namespace, host, CIDR, or digest carries into a copy.

- Verified STARTTLS to the substrate MTA (§2 GOTCHA 3): `great-falls-tool-bus-infra`
  `k8s/list/**` deployment `env` + `scripts/validate-list-stack.sh` (issue #74).
- Light branding overlay (§2): `k8s/list/**` branding ConfigMap +
  `settings_local.py` + second `--static-map` (TIN-2561).
- Network-enforced PoW gate (§3): `k8s/archive/**` networkpolicy +
  `scripts/validate-archive-stack.sh` (PR #77).
- Host-networked SNAT asymmetry (§3): `k8s/list/**` + `k8s/archive/**`
  networkpolicy comments (ipBlock vs namespaceSelector).
- Read-path exemption + AI-scraper DENY ordering (§3): `k8s/archive/**`
  configmap-anubis-policy + `scripts/validate-archive-stack.sh` (TIN-2559).

---

## 10. Adoption checklist

1. Stand up the **list stack** (§2): co-located pod, `--static-map`,
   `DJANGO_ALLOWED_HOSTS` with the Service FQDN, `archive_policy` per list.
   Round-trip smoke (send → archive appears) **before** any public exposure.
2. Add the **Anubis gate** (§3, #55) and its netpol pair — mind the post-DNAT
   egress port.
3. Wire the **site data plane** (§5) and **surface** (§6) with the privacy gate
   (§7). It builds green off-cluster (empty state) from day one.
4. Keep everything **declare-only / flags-off**: `<route>_dns_enabled = false`,
   no tunnel route, `PUBLIC_*_LIVE`/`PUBLIC_*_PREVIEW` false.
5. Go-live, **in order**: privacy pre-flight → tunnel public-hostname route
   (dashboard) → `<route>_dns_enabled = true` + live round-trip smoke → flip
   `PUBLIC_*_LIVE`.

## 11. Deliberately out of scope

- Concrete manifests, tunnel ids, DKIM/secret material — those live in the
  cited infra repo, operator-owned; this doc is the parameterized shape only.
- Building the container image (see GloriousFlywheel #1038).
- Outbound federation — a spoke consumes and reads; it never delivers.
- The Anubis manifest detail (#55) and the flag idiom itself (#56) — adopted by
  reference, not restated.
