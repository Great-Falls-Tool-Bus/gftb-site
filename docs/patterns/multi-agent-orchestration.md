# Multi-agent orchestration for a community-infra capstone

The two sibling docs in this directory capture **what** the Great Falls Tool Bus
(GFTB) capstone built — the [community mailing-list + on-site
archive](./community-list-and-archive.md) and the [reusable UX
primitives](./reusable-ux-patterns.md). This doc captures **how** it was built:
the multi-agent working methodology that let one operator plus a top-tier-model
orchestrator ship a full community-infra program — a static site cut over to
on-cluster serving, a public mailing-list archive with an on-site reader, a
fail-closed edge/DNS enable sequence — over 2026-07-05/06.

It is a **process pattern**, not a repo feature. Nothing here is code the
scaffold ships. It is the operating contract for standing up the *next*
community project with the same small crew and the same safety record. The goal,
in the operator's words: *"the next community project that needs this kind of
infra, we are ready."*

> **Reference implementation.** Every rule below is distilled from the real
> program: `Great-Falls-Tool-Bus/greatfallstoolbus.org` (the SvelteKit site,
> spawned from this scaffold) and `Great-Falls-Tool-Bus/great-falls-tool-bus-infra`
> (the k8s/tofu/mail/edge infra sister). PR and `TIN-` anchors are cited inline
> as evidence and collected in §9. Where a rule prevented a real incident, the
> failure mode is stated — those are the load-bearing parts.

---

## 1. The crew — orchestrator + operator as SWEs-in-the-room

Two humans-in-the-loop-shaped roles, plus disposable labor:

- **The orchestrator** is a single top-tier-model session that coordinates the
  whole program. It **personally reviews every diff before merge and holds merge
  authority** — no subagent merges its own work. It does the delicate,
  prod-touching steps **inline** (DNS origin flips, the archive go-live on prod,
  the tofu applies) rather than delegating them.
- **The operator** (the human) makes **keystone decisions** through short
  **option-gates** — 2–4 framed choices, not open-ended prompts — and can
  **redirect a running agent mid-flight**: a message queued to a live agent
  changes its architecture without a restart. The mid-program pivot to
  *adapter-node SSR as the production serving mode* (site `#116` amending ADR
  0010, `#121` live per-request SSR) landed as a redirect, not a re-plan.
- **Scoped background agents** do the bulk work in parallel, each on a tight
  brief with a tight tool subset.

**Failure mode this prevents.** Diffusion of merge authority. When any worker can
merge, prod-touching changes land without the one reviewer who holds the whole
program in context. Centralizing merge on the orchestrator is what makes the rest
of the safety doctrine enforceable.

---

## 2. Model tiering — spend reasoning where it changes outcomes

Match the model tier to the judgment the task carries:

- **Sonnet-tier for mechanical / sweep work** — formatting, dead-code removal,
  comment fixes, lockfile bumps, mechanical renames. Anchors: site `#106`
  (prettier-format to unbreak main lint), `#99` (correct a stale
  `svelte.config.js` comment), `#83` (remove dead components + unwired script),
  `#115` (transitive lockfile bump).
- **Opus-tier for design / research / judgment-bearing work** — architecture
  briefs, decision records, privacy-invariant design, UX. Anchors: site `#118`
  (HyperKitty archive-UI theming decision brief), infra `#50` (GloriousFlywheel
  overlay-leverage review), infra `#47` (on-cluster serving research), the
  operator design passes (site `#87`, `#90`).
- **Top-tier orchestrator inline for the delicate / prod-touching steps** — the
  DNS flip (infra `#63`), the archive go-live on prod (site `#108`), the tofu
  applies.
- **When unsure, omit the model and inherit the session tier.** Do not
  down-tier a task you cannot cleanly classify as mechanical.

**Failure mode this prevents.** Both directions of mismatch: a mechanical sweep
run on a top tier burns budget for no gain; a judgment-bearing design task run on
a mechanical tier ships a plausible-looking wrong decision that costs far more to
unwind than the tier saved.

---

## 3. Delegation hygiene — the spawn contract

Every background agent gets the same non-negotiable brief. Skipping any line here
is where parallel workstreams corrupt each other.

1. **Unique clone dir + explicit remote verification.** Each agent clones into
   its **own** `$TMPDIR` path and verifies `git remote -v` before touching
   anything. *Failure mode:* two agents cloning to the same scratch path clobber
   each other's work and you audit ghosts on local disk instead of `gh` truth.
2. **Explicit branch instructions where default != integration.** If a repo's
   default branch is not the branch you integrate on, say **"fetch `main`
   explicitly."** *Failure mode:* an agent branches off a stale local ref and its
   PR diff is polluted with everyone else's already-merged work. (Bit repeatedly;
   local `main` in this very repo was stale mid-program.)
3. **Explicit DO-NOT-TOUCH file lists.** Name the files another in-flight
   workstream owns. *Failure mode:* two agents edit `svelte.config.js` (or the
   same lane file) and the second silently reverts the first. Keeping `main`
   green during parallel work (site `#92`, `#106`) depends on this.
4. **"Do NOT merge — report back."** Merge authority is centralized (§1). An
   agent's job ends at a pushed branch + PR + a report. *Failure mode:* an
   unreviewed prod-touching PR self-merges.
5. **Durable outputs into git/PRs, never ephemeral scratch.** Research,
   verdicts, and plans are committed (a PR, a `docs/` note), not left in
   `/tmp` or a harness "scratchpad." *Failure mode:* a compaction/rotation sweep
   wipes thousands of dollars of agent output. (This rule is codified
   machine-side — see §8.)
6. **Final-message-as-report discipline.** The agent's last message is the
   deliverable: PR URL(s), what changed, what it verified, what it left out. The
   orchestrator relays it; nobody reads the agent's scratch files.

> **Isolation gotcha.** A worktree-isolation spawn clones the **current working
> directory's** repo, not whatever target repo you named in the prompt. If an
> agent must work in a *different* repo, tell it to clone that repo explicitly
> and verify the remote (rule 1) — do not assume isolation put it there.

---

## 4. Verification doctrine — never merge a claim about prod

A subagent's "done / verified" is an input to verification, never a substitute
for it. For anything that touches prod, **re-verify live.**

1. **Review the tofu plan before every apply.** This is the marquee rule. During
   the apex go-live (`TIN-2528`), plan review caught that an apply would have
   **reverted the Cloudflare Access allowlist** (the `ACCESS_ALLOWED_EMAILS_JSON`
   edge secret) and **silently kicked authorized users**. A green plan is not a
   safe plan; read the diff.
2. **Check privacy/exposure gates against the running cluster before DNS.**
   Because one HyperKitty instance served both public and private archives at the
   same host, exposure was gated by a **live pre-flight ordered before** DNS
   enable and the tunnel route (infra `#58` `archives_dns_enabled`, `#63` apex
   flip; site `#89` fail-closed public surface, `#54` PII surface gate). A
   privacy regex that *looked* right had missed `192.168.x`/`172.x` — caught only
   by re-verification (site `#100`), never by static review.
3. **Post-change live proof over green-CI trust.** Prove the behavior on the
   running system: SSR proven by **body-hash + render-timestamp deltas** across
   requests (site `#121`); netpol proven by **in-cluster probes**, not manifest
   reading (infra `#37` tightened REST netpol, `#36` localhost-trust
   co-location, `#32` archive path); egress proven by **live-evidence reconcile**
   (infra `#28` SPF authorizes the real honey egress IP). Health-gate the new
   replicas before flipping traffic (infra `#60` replicas 0→2 + `/health`; site
   `#111`).
4. **Run adversarial review stages on findings.** A second agent tries to break
   the first's conclusion before it is trusted. Findings that survive an
   adversarial pass are trustworthy; findings that only survive a friendly read
   are not.

**Failure mode this prevents.** Acting on a plausible but false "verified." The
allowlist revert (rule 1) would have been an invisible outage; the WebGL/text
CI-blindness class (see `AGENTS.md` → "Testing & Browser-RBE Smoke Suite")
routinely passes CI while the live surface is broken.

---

## 5. Git & CI habits

- **PRs always. Never commit direct-to-default-branch via the API.** Direct API
  commits bypass the format/lint gates that only run on PRs — burned once,
  surfaced later as a broken-lint cleanup (site `#106`). Every change in the
  program went through a PR.
- **Conventional commits, no AI attribution.** Scope-typed subjects with a
  `TIN-` anchor (`feat(discuss): … (TIN-2528)`). No `Co-Authored-By` for AI.
- **The merge-on-green-after-review gate chain.** directed work → executed →
  SSOT-aligned → present in the tracker → reviewed by the orchestrator → CI
  green → **merge**. Do not park an already-reviewed green PR on the operator;
  finishing the chain is the orchestrator's job.
- **Squash + delete-branch** on merge.
- **Fail-closed dispatch workflows for anything prod-touching.** Applies are
  `workflow_dispatch`-only with a **typed-confirm sentinel** and a
  **secret-presence gate** — no ambient apply on push. Anchors: infra `#56`
  (fail-closed one-dispatch web-stack apply), `#59` (dispatch archive-stack
  apply), `#51` (tightened release safety gates); site `#92` (skip the
  adapter-node image build when the `GF_CORE` credential is absent — keep `main`
  green instead of failing open).
- **Declare-only before apply.** Land the manifests/tofu as reviewable but
  **not applied** first, then apply through the gated lane. Anchors: infra `#27`
  ("reviewable, not applied"), `#45` (declare-only packet), `#48` (declare-only
  on-cluster serving); site `#86` (declare-only container readiness).
- **One-off workflows that clean themselves up.** A task-scoped workflow does its
  job and then a follow-up removes it, so the workflow list does not accrete dead
  dispatch surfaces. Anchor: site `#122` (one-off workflow to delete the retired
  Pages project) → `#123` (remove that workflow once executed).
- **Watch-and-merge-on-green background loop.** A cheap background poller merges
  a reviewed PR the moment CI goes green, instead of the orchestrator busy-waiting.

**Failure mode this prevents.** Silent gate bypass (direct API commits), apply
happening by accident (ambient triggers), and dead one-off machinery that later
reads as a live prod control.

---

## 6. Ops habits for shared / prod surfaces

- **Surgical shared-config mutation.** To change one rule inside a shared config
  that carries *other* production (the program did this on a shared Cloudflare
  tunnel with ~22 ingress rules, flipping the apex/www origin to the on-cluster
  tunnel — infra `#63`, and gating `forms.` earlier — `#41`): **read → back up →
  clone an existing rule as the template → build the modified rule → diff-proof
  (exactly N lines change, no more) → write → integrity-verify → auto-rollback on
  any mismatch.** Never hand-edit a shared multi-rule surface in place. *Failure
  mode:* a stray edit takes down the other production riding the same tunnel.
- **SSOT-first fixes — fix the declared source, never the live resource.** Add an
  allowlisted email to the `ACCESS_ALLOWED_EMAILS_JSON` **edge secret**, not via
  the Cloudflare API; the next edge apply reverts anything done only to the live
  resource. *Failure mode:* your fix silently disappears on the next apply and
  you debug a "flapping" resource that is really a fight with its own SSOT.
- **Health-gate before destructive steps.** Bring the new thing up and prove it
  healthy *cold* before flipping to it and before tearing down the old (blue/green;
  infra `#60`, site `#111`). Rollback is "flip back to the still-warm prior."
- **Secrets decrypted transiently and shredded.** Decrypt sops material only for
  the moment it is needed, never write it to the tree, and shred the plaintext.
  Gitleaks runs through the Justfile (`just secrets-scan-dir`).
- **UI-only settings via browser automation with an imported operator session.**
  When a control has no API (e.g. GHCR package visibility), drive it through the
  headless browser with the operator's imported session — do not hand-wave it as
  "set it in the dashboard." (Machine-side; see §8.)

**Failure mode this prevents.** Collateral damage on shared infra, and "fixed it
but it reverted" churn from editing live resources instead of their SSOT.

---

## 7. Tracker-backed truth

- **Reconcile every ticket with evidence, then move it.** A ticket goes to Done
  only when it carries verifiable evidence — PR numbers, run IDs, a live-proof
  note — not on a subagent's say-so. The `TIN-` anchors threaded through §§2–6
  are that evidence trail.
- **Create follow-up tickets with relations,** not TODO comments that rot. The
  reusable-lane and gate follow-ups the program spun off (referenced from the
  [community-list doc §9](./community-list-and-archive.md)) are tracked issues
  with relations, not buried notes.
- **Flag contradictions; do not force-resolve them.** When evidence disagrees
  with a ticket's stated state, surface the contradiction for a keystone decision
  (§1) rather than quietly picking a side.

**Failure mode this prevents.** A tracker that reads "done" while prod disagrees —
the exact state that makes an org stop trusting its own tracker.

---

## 8. Machine-level (lab) adoption notes

Some of this doctrine is **machine-level**, not spoke-level: it applies to every
repo the operator orchestrates from their workstation, so its home is the
operator's machine-config repo (`tinyland-inc/lab`), not this scaffold. The
portable pieces:

- The **delegation-hygiene preflight** (§3) and the **model-tiering choice** (§2)
  as a reusable slash-command / command asset under lab's `.claude/commands/`, so
  every session opens a spawn with the same contract rather than re-deriving it.
- The **durable-output rule** (§3.5) is already codified in lab as the
  anti-ephemeral directive: agent working output goes to git-tracked
  `docs/agent-notes/` (`TIN-2520`), never to `/tmp` or a harness scratchpad that
  a rotation sweep can wipe.
- The **UI-only-via-imported-session** habit (§6) and **transient-secret
  handling** are workstation capabilities, not spoke code.

> A companion proposal for these lab-side assets is filed as `tinyland-inc/lab`
> issue #726. This doc is the SSOT for the *methodology*; the lab asset is the
> machine-level *entrypoint* to it.

---

## 9. Cross-references & evidence index

**Sibling patterns (what this crew built):**

| Doc | What |
| --- | --- |
| [`community-list-and-archive.md`](./community-list-and-archive.md) | The mailing-list + on-site archive this methodology delivered |
| [`reusable-ux-patterns.md`](./reusable-ux-patterns.md) | The UX primitives distilled out of the same spoke |

**Reference-implementation anchors (GFTB):**

- **Site** (`Great-Falls-Tool-Bus/greatfallstoolbus.org`): static→on-cluster
  cutover + ADR 0010 (`#107`, `#116`, `#120`); adapter-node SSR go-live (`#111`,
  `#121`); archive UI + fail-closed surface (`#89`, `#112`, `#114`, `#117`);
  privacy-gate fix (`#100`); keep-main-green + self-cleaning ops (`#92`, `#106`,
  `#122`, `#123`); operator design passes (`#87`, `#90`).
- **Infra** (`Great-Falls-Tool-Bus/great-falls-tool-bus-infra`): shared-tunnel
  DNS origin flip (`#41`, `#63`); fail-closed dispatch-apply lanes (`#51`, `#56`,
  `#59`); declare-only staging (`#27`, `#45`, `#48`); netpol/egress live proof
  (`#28`, `#32`, `#36`, `#37`); health-gate cutover (`#60`); PII/operator-surface
  gates (`#53`, `#54`).
- **Marquee incidents:** the tofu-plan-review allowlist-revert catch and the
  SSOT-first allowlist fix (both `TIN-2528`, apex go-live); the private-IP privacy
  regex miss (site `#100`).

**Related scaffold contracts:**

- `AGENTS.md` → "Multi-Agent Orchestration" (the pointer into this doc) and
  "Testing & Browser-RBE Smoke Suite" (the CI-blindness class §4 guards against).
- [`docs/CI-SCHEMA.md`](../CI-SCHEMA.md) — the fail-closed lane/dispatch contract
  §5 relies on.
- [`operator-gate-handoff.md`](./operator-gate-handoff.md) — gate and handoff
  artifact rules (WORD/NATIVE/LOOK) are formalized there; this doc remains the
  crew/process substrate.

## 10. Spawn checklist — standing up the next community project

1. **Spawn the site from this scaffold** (`gh repo create --template
   tinyland-inc/site.scaffold`, then `scripts/rebrand.sh`). Stay
   **adapter-static** by default; flip `--adapter=node` only when the project
   genuinely needs a server (GFTB needed it for live archive SSR — site `#121`;
   see [`docs/decisions/dynamic-spoke-adapter-mode.md`](../decisions/dynamic-spoke-adapter-mode.md)).
2. **Stand up a separate infra sister repo** for anything stateful — the k8s
   stacks, tofu edge/DNS, mail. Keep the spoke a spoke; the Mailman/Anubis/tunnel
   plane never lands in the static site (the boundary the community-list doc
   enforces).
3. **Name the crew (§1):** one orchestrator with merge authority; the operator on
   option-gates; scoped background agents. Nobody but the orchestrator merges.
4. **Give every spawn the §3 brief:** unique clone dir + remote check, explicit
   branch, DO-NOT-TOUCH list, "do NOT merge — report back," durable outputs.
5. **Wire fail-closed dispatch-only apply lanes (§5) and go declare-only first**
   (§5) for every prod-touching stack.
6. **Gate public exposure behind a live privacy/PII pre-flight ordered before
   DNS** (§4), and re-verify it against the running cluster — not against a green
   check.
7. **Review the tofu plan before every apply** (§4.1). No exceptions.
8. **Keep the tracker honest (§7):** evidence-backed Done, follow-ups with
   relations, flagged contradictions.

## 11. Deliberately out of scope

- Concrete manifests, tunnel ids, and secret material — operator-owned, in the
  infra sister repo; this doc is the parameterized *method* only.
- The lab-side command asset itself — proposed by reference in §8, not restated
  here.
- The *what* of the build — that is the two sibling docs; this doc is only the
  *how*.
