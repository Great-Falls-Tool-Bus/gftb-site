# Operator gate handoff contract

Status: generic source contract; per-product gate installation is separate
Coordination: TIN-3274; related: TIN-3011 (authority contract), TIN-3065
(pre-merge admission)

Ratified: 2026-07-29. Behavior authority: lab `policy/delegation.json`
(`gate_handoff` block; that block lands with lab `#1079`, so this is a
forward reference until `#1079` merges). This document is the prose carrier
and never forks it.

Anchor rulings (verbatim, immutable; amendments append, never edit):

> "I like the approval idea; the handoff to browser or use interview feature
> etc is a critical element of this (the actual handoff and action, with human
> readable and understandable context; we are both busy SWEs!)"

> "This is fundamentally flawed, this login was not approved. we MUST be able
> to approve our own PRs, indeed agents with a review pass + ratification via
> interview + QA approval in browser should be sufficient for prod escalation.
> this structural obfuscation you just described is symptomatic of the problem
> (arbitrary structure drift)"

Ratified 2026-08-01 (appended per §12): the live MassageIthaca LOOK flow —
the PR-lane QA route opened in the operator's Chrome, the AskUserQuestion
interview, and the sha-bound `SHIP-PROD` relay — is the reference §5 LOOK loop.
The former scaffold admission workflow/checker coupled this contract to a
wrong-owner receiver and was removed on 2026-08-03; the ruling survives while
each product binds it to its owner-issued QA receipt:

> "the assertion, open in chrome, the dialog with the interview feature in
> precisely this way is exactly the envisioned ontology of UI iteration for
> HITL + our PR env reaper lane"

## 1. The flow

Agent builds → independent agent adversarial review pass → operator
ratification via interview (the selected AskUserQuestion answer IS the
operator word) → agent relays the word to the native surface with receipts →
for platform-native gates the agent opens the exact URL in the operator's
browser with the one-screen context block (§4) → operator browser QA for
client-visible surfaces. Interview framing rules (2-4 framed options, durable
carrier, transcript-only is not ratified) live in `interview_hitl` and are
referenced, not restated here.

## 2. One gate, one type, one message

Every operator gate is exactly one of WORD, NATIVE, or LOOK, and the agent
names the type when presenting it. A gate is its own message — first line,
nothing else in it. Failure mode this prevents: the buried gate the operator
never sees.

## 3. WORD gates (ratifications and ship words)

The selected interview answer carries the literal token verbatim (e.g.
`SHIP-PROD: <sha>`); no paraphrase between selection and relay. The word binds
to one (sha, surface) pair — one merge, one env approval, one QA route — with
the sha verified as current HEAD immediately before the interview. HEAD
movement, rebase, scope change, or any fresher operator word voids it; a word
is never reused or transplanted. Every interview offers at least one explicit
decline/hold option; yes-only interviews are banned. The question body carries
the full sha, one sentence of what the word authorizes, evidence links, and
what happens next. Relay: the agent posts the word verbatim to the native
surface as a sha-bound artifact. Any affirmative review state carries it;
self-review is the design; review count 0 is the design. Failure mode this
prevents: the MassageIthaca admission-gate main freeze (struck 2026-07-29 as
arbitrary structure drift).

## 4. NATIVE gates (env approvals, pending deployments, protected applies)

Verify before handoff: confirm via API that the gate is live and pending (run
id, environment, state); never hand off a guessed or stale URL. Open the exact
pending-approval URL in the operator's browser — the run, not the repo, not
the Actions tab. Deliver the one-screen context block, exactly five fields,
readable with zero session context (internal codenames glossed inline):

- **What this is** — one sentence; names the workflow, run, and environment.
- **What one click releases** — the precise action the approval triggers.
- **What it does NOT do** — explicit negative scope.
- **Expected artifact** — what exists afterward and where.
- **Next step after** — who does what next; whether the agent resumes
  automatically.

Failure mode this prevents: the tofu-plan run invisible for 8+ hours at a
hidden environment gate ("please actually open this; currently this gate is
hidden").

## 5. LOOK gates (browser QA on client-visible surfaces)

A live URL on an established served environment (never a local server), opened
in the operator's browser, with the serving lane and served sha stated and
verified first — merged/CI-green ≠ served. Alongside the URL: a look-list of
at most 5 "surface → expected state" items, at least one of which would
visibly regress if the change were wrong. Screenshots may accompany but never
replace the live URL. LOOK and WORD are separate gates; neither substitutes
for the other. Failure mode this prevents: the 2026-07-05 synthetic-Host
class, where app-code-only evidence hid an unserved rebrand all day.

## 6. Sufficiency for production escalation (floor and ceiling)

Fixed by the 2026-07-29 ruling quoted above: (1) independent-agent adversarial
review pass, (2) operator ratification via interview (WORD), (3) operator
browser QA (LOOK) on client-visible surfaces. Nothing more may be required —
no second approver, no APPROVED-only state, no second-identity presumption, no
unratified ceremony; a gate demanding more is drift under §7. Nothing less is
acceptable — no leg waived by urgency, momentum language, or status claims,
except where a ratified checker itself carries a scoped waiver (reference
implementation: docs-only waives the QA leg only; the WORD leg is never
waived). In a site.scaffold product these gates stay expressible within the
[production convergence contract](./production-convergence.md) — as its §2
pre-merge admission evidence or its §5 checked-in workflow-state toggle.

## 7. No arbitrary structure drift

The ratified intent of a gate is its only mechanic. Any mechanism added beyond
the ratified words — a review state, a review count, a second identity, an
approver role, a protection rule, a required-check rename — is a new decision,
and a new decision requires its own interview ratification before it binds
anyone. An unratified mechanic is drift even when stricter; hardening is not
an exemption. When a platform's native semantics conflict with the ratified
intent (GitHub forbids author self-approval), the intent wins and the
implementation routes around the platform; a platform default is not a
ratification. Failure mode this prevents: "the operator sha-bound SHIP-PROD
word gates every merge" elaborated into APPROVED-state + review-count-1
mechanics, which no PR in a single-identity estate could ever satisfy.

## 8. Single identity is the design

This estate is single-identity. Self-review and self-approval are the design,
never a gap to be closed. No gate, checker, or reviewer may presume a second
identity exists or require one.

## 9. Receipts chain

Four links, each naming its predecessor; a broken link anywhere means the word
was never given, and the gate denies:

1. **Interview record** — framed options; the selected answer text contains
   the sha. Transcript-only is not ratified.
2. **Relayed native action** — the word posted verbatim, sha-bound, quoting
   the interview. The relay adds nothing; paraphrase or scope-widening breaks
   the chain.
3. **Receipt** — PR and/or Linear comment carrying the verbatim word, full
   sha, and a link to the native action. This is the billable sha=receipt
   artifact. Receipts are runtime evidence and are never checked into the
   tree.
4. **Verification hook** — a checker validates link 2 mechanically (token
   shape, identity, sha binding, freshness).

Receipts-first across lanes: before opening any interview, check the native
surface for an existing receipt for the same (sha, surface); found means relay
and act, never re-ask. A lane opening an interview first posts an
interview-open marker (sha + surface + timestamp + session slug); a second
lane finding a live marker polls receipts instead of double-asking. A receipt
supersedes its marker; duplicate receipts are false artifacts, removed on
discovery.

## 10. Unattended gates

A gate waiting 30 minutes is re-surfaced with the same context plus elapsed
wait time, and again at escalating intervals; no gate ages silently. Headless
and cron lanes never self-answer, simulate a word, downgrade a threshold, or
timeout-then-proceed: the gate waits, and the lane leaves a handoff packet —
the §4 block plus the (sha, surface) binding and exact URL — on a surface the
operator actually reads before parking or exiting. If a session ends with a
gate pending, the packet lands on a durable carrier first. An agent
discovering a pending gate it did not create surfaces it the same way; it
never works around it.

## 11. Banned anti-patterns

- Gate buried in prose → unseen gate (§2).
- Jargon-only handoff → operator archaeology to act (§4).
- Requesting a word without the exact full sha and exact URL in the same
  message → un-bindable word (§3).
- Elaborating a ratified word into unratified mechanics → the admission-gate
  freeze (§7).
- Requiring more than §6 or accepting less → drift in either direction.
- Open-ended "should I ship?" or yes-only interviews → unframed or coerced
  ratification (§3).
- LOOK evidence from screenshots-only or a local/synthetic serve →
  app-code-only evidence (§5).

## 12. Amendment

This contract is amended only through the flow it defines: draft → adversarial
review → interview ratification of the specific delta (the answer names the
clause and the sha) → relay + receipts → same-PR update of the pinning tests
(ruling and test land in one PR). Editing this contract, its pinning tests, or
a conforming checker without an interview-ratified delta is itself drift under
§7 — and trusted-base execution means a PR that weakens a gate is still
admitted by the old gate. Anchor quotes are immutable; amendments append a new
ratified date and quote.

## 13. Product implementation boundary

MassageIthaca's July 2026 admission checker is historical evidence for the
SHA-bound word, accepted review states, review-count-zero design, and
trusted-code requirement. Its receiver-specific QA producer is not a template.
A current product implementation must consume an exact-head QA receipt issued
by the product owner overlay and pin that interface in product-owned contract
tests. This scaffold carries the behavior contract, not the runtime checker.

## Machine-readable contract

Behavior authority: lab `policy/delegation.json` → `gate_handoff` block,
asserted fail-closed by `tests/unit/test_delegation_policy.py`; block and
assertions land with lab `#1079`, so both are forward references until
`#1079` merges. Mechanically
pinnable per installation: word-token shape, accepted-states positive and
negative pins, review-count-0, five-field block presence, no checked-in
receipts, no auto-satisfying triggers on gate-carrier workflows. Interview
framing quality, handoff readability, re-surfacing cadence, and whether a gate
was actually exercised are runtime truth — doctrine with named failure modes,
never fake-tested.

## Non-authorization

This source contract does not merge any PR, approve any environment, relay any
word, alter branch protection, or install a gate anywhere. Each of those
remains a separately reviewed action in the repository that owns it, released
only by the operator word this contract describes.
