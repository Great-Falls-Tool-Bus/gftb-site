# Agent contract — Great Falls Tool Bus public microsite

## Role and authority

This private repository builds the public static site at
`greatfallstoolbus.org`. It owns reviewed public page copy, build-time `.svx`
daily logs, the static build graph, and a candidate OCI publisher.

It owns no member records, auth, payments, mail administration, private
content, DNS, Cloudflare state, cluster state, or GitOps apply authority. The
browser may submit the public contact form to the separately owned
`forms.latoolb.us` API. This repo neither implements nor administers that API.

The production image identity is exactly
`ghcr.io/great-falls-tool-bus/gftb-site`. Publishing a `sha-<40 hex SHA>` image
does not deploy it. Infra selection, digest pinning, apex cutover, served
readback, and rollback remain outside this repo.

## Public-content boundary

Public daily-log frontmatter is exactly:

- required: `date`, `title`, `summary`, `tags`, `published`
- optional: `updated`

Every file in `src/content/log/` is public build input and must set
`published: true`; drafts do not belong in that directory.

Never publish Linear IDs, PR numbers, commit SHAs, repository pointers,
credentials, member information, private locations, or internal operational
notes. The public site must not expose agent indexes, source maps, developer
docs, or private list archives. `discuss@latoolb.us` is the public discussion
list and archive; `keyholders@latoolb.us` is a private role list whose archive
is not public.

## Entrypoints and stack

- Use `just <recipe>` for every operation. Do not invoke pnpm, Vite, or Bazel
  directly outside the Justfile.
- Enter through `nix develop` / direnv. CI runs Just inside Nix.
- `just build` produces the adapter-static site under `build/` through Bazel,
  then leak-scans it (see below). A published tree that has never been scanned
  is not publishable.
- `just check` runs secret, endpoint, printed-QR, conformance, entrypoint,
  formatting, typecheck, and unit-test gates.
- `just conformance` validates the live minimal-spoke contract.
- `just qr-verify` regenerates the printed apex QR and proves the committed
  SVG matches, ignoring only the `<!-- Created with qrencode X.Y.Z -->`
  provenance line so an encoder patch bump is not a false failure. The unit
  suite separately decodes the payload.
- `just qa-packet [port]` produces the reviewable QA evidence packet for one
  build under `qa-packet/<sha>/` (git-ignored): every top-level route at the
  spec §3 widths, in both colour schemes, at 200% zoom, with reduced motion, and
  with keyboard focus on the primary call to action and the contact submit, plus
  an `INDEX.md` receipt of what `build`, `check`, the unit suite, the browser
  acceptance suite and `leak-scan` reported for those bytes. It runs the gates
  itself and stands up its own preview on its own port, so a packet always
  describes one tree. `just qa-packet-diff <baseline> <candidate>` produces
  per-image pixel diffs and a `DIFF.md`. `INDEX.md` and `manifest.json` are
  leak-scanned with the same rules as the published build. Neither recipe is a
  CI gate. Operator guide: `docs/qa-packet.md`.
- `just leak-scan` runs the rules in `scripts/lib/leak-scan-rules.json` over a
  built artefact. `scripts/check-build-output.mjs` is a thin runner over
  `scripts/lib/leak-scan.mjs`, the same module `src/lib/leak-scan.test.ts`
  exercises: one implementation, tested once. It fails closed — a missing or
  empty directory, or a file whose extension is in neither `TEXT_EXTENSIONS`
  nor `SKIP_EXTENSIONS`, is a failure, not a pass. Set `GFTB_LEAK_SCAN_DENY`
  to add operator-held literals; never commit them.
- `scripts/lib/*` is acceptance-test-only and deliberately outside `src/lib`:
  the leak ruleset carries credential-detection regexes and must never be
  reachable from a client bundle. `eslint.config.ts` forbids `src/**` from
  importing it and `src/lib/leak-scan.test.ts` asserts the same from the other
  side.
- Skeleton and Skeleton Svelte are exact-pinned at `5.0.0`, following the
  proven Svelte 5 pattern in `jesssullivan.github.io`. Do not restore the
  Skeleton 4 compatibility shim.
- GloriousFlywheel is cache-first. Endpoints and credentials come only from
  the runtime environment. Do not create runners or hard-code cache/executor
  endpoints.
- Org ARC jobs use `tinyland-nix`; both reusable-workflow heavy and KVM inputs
  are explicitly mapped to that available class.

### Which CI job runs which gate

CI is `tinyland-inc/ci-templates/.github/workflows/spoke-ci.yml@v2.12.2`. Every
gate below is named with the job and line that executes it, so a gate can never
again be described as enforced when nothing runs it:

| Gate | spoke-ci.yml job | Line |
| --- | --- | --- |
| `just check` — conformance, endpoint, secrets, entrypoint, `qr-verify`, and `//:local_validation_suite` (which carries `//:unit_tests`, the acceptance unit gates) | `flywheel-test` | 291 |
| `just build` — Bazel static build, then `just leak-scan build` | `flywheel-build` | 267 |
| `just build` again, transitively, as the Playwright web server | `playwright` | 375 |
| `just test-e2e` — the browser acceptance suite | `playwright` | 375 |
| `bazelisk mod graph`, `bazelisk build //:node_modules` | `bazel-graph` | 307, 311 |
| gitleaks over full history | `secrets-scan` | 115 |

`just ci` is a local convenience aggregate. **No template job invokes it**, so
nothing may be enforced only from there.

## Deployment and package safety

`.github/workflows/container-ghcr.yml` may publish only the immutable candidate
tag for its exact commit. It has no production dispatch and no infra, DNS, or
edge credentials. GitHub Pages workflows are forbidden. A merge, green CI, or
successful package push is not served-site proof.

Source stays private. The operator release lane may make only the reviewed web
image package public after publication, then must prove anonymous manifest and
digest pull. Do not add registry credentials or image-pull secrets here.

## Delete-after-rewire policy

The repository tip contains only live carriers. When a path becomes obsolete:

1. Map every reference from AGENTS, Just, CI, Bazel, skills, schemas, tests,
   licenses, and deployment contracts.
2. Rewire those live consumers to the chosen replacement.
3. Delete the superseded Markdown, script, generated copy, JSON, fixture, and
   workflow in the same change. Git history is the recovery mechanism.
4. Run `just source-map-check`, `just endpoint-check`, `just secrets-scan-dir`,
   `just conformance`, `just check`, and `just build` before landing.

Do not keep historical evidence directories, research notes, examples, public
agent artifacts, or unused scaffolding “just in case.” Do not delete a schema
or script while any live entrypoint still references it.

## Multi-agent and git posture

- One lead session holds merge authority. Other sessions may open PRs but do
  not merge or close work owned by another session.
- Sync and scan open PRs before starting a lane. File fences win.
- Preserve unrelated dirty worktree changes.
- Use signed commits; never add AI attribution.
- This repo stays private until an explicit visibility decision.

## Licenses and assets

Software is zlib-licensed; written GFTB content is CC BY-SA 4.0. Visual and
vendored-code provenance lives in `NOTICE` and `docs/attribution.md`.

## GFTB SSOT grounding (binding; added 2026-08-20 after a 4-day drift incident)

Every agent lane touching this repo MUST ground in these authorities and cite
the specific section/ticket/file for every substantive change (PR bodies carry
an Authority citations table; reviews check citation-conformance FIRST —
uncited changes are a review BLOCK). Nothing here is an open question:
**decisions are decided-by-default** — search these sources before ever
writing "open question" or "needs ratification".

### The SSOT, in authority order

1. **meta repo** (`Great-Falls-Tool-Bus/meta` @ origin/main — ALWAYS fetch;
   stale local checkouts have caused false not-found results):
   - `spec/launch-member-v0-system-2026-08-16.md` — THE implementation and
     acceptance contract. §3 public-site contract (8-row page order, log
     schema, contact relay), §8 tool custody, §10 forms/contact matrix.
   - `decisions/0014-launch-member-v0-ratification-2026-08-16.md` (ratified;
     §1 repo split, §7 inventory pilot) and
     `decisions/0015-citylink-palette-ratification-2026-08-17.md` (ratified).
   - `spec/gftb-citylink-palette-2026-08-17.md` + `spec/gftb-citylink-palette/`
     — **Appendix A is the number authority**; `gen_board.py:149-180` is the
     **ratified role-application table** (cream `surface-100` page ground,
     paper panel, `primary-800` headings, `primary-700` links [dark `300`,
     pinned], yellow livery block `--highlight` + `--highlight-edge` 1.4.11
     rescue, contact panel inverted `primary-900` both schemes). A
     disagreement between Appendix A and `src/lib/theme/palette.ts` is a
     **stop condition** — report, never hand-edit.
   - `diagrams/launch-member-v0/*.mmd` — the five-diagram design ontology
     (inventory-custody-flow, member-lifecycle, member-projection-flow,
     launch-authority-flow, release-proof-flow). Diagram colors are the brand
     identity: yellow `#f5d547` action / creme `#eee7dd` state / purple
     `#4b2354` authority / ink `#23152a`.
2. **The operator-built demo site** = design decisions in code:
   `greatfallstoolbus.org` repo @ main (fa5552c era) — commits #87 (design
   pass: de-card, zero radius, intentional full-bleed bg), #90 (`.hero-band`
   full-bleed parallax + hero-glass; `src/lib/motion.svelte.ts`), #94
   (SourceLink / generated source-map edit-this-page), `src/lib/nav-items.ts`
   (nav SSOT), `src/app.css` (spacing rhythm, glass idiom), `src/lib/data/
   cells.ts` (svx pipeline pattern), `src/routes/contact/` (forms
   architecture: own page + ALTCHA PoW + relay — never a form on the root).
   Port from it; never reinvent.
3. **Linear** (execution tracker; read descriptions AND comment threads):
   initiative "Great Falls Tool Bus — Launch"; document "GFTB launch
   operating map". Milestone spine: 08-16 apex (TIN-2366/2401/3437/3816) ·
   08-30 Member v0 (TIN-3815/3817/3440/3818) · 09-10 hardening
   (TIN-3481/3813) · 09-15 rehearsal (TIN-3814) · 09-20 custody pilot
   (TIN-3847) · 09-27 reliability (TIN-3848). Custody-adjacent:
   TIN-3498/3502. Live QA: TIN-3932. SLA labels `sla:same-day` /
   `sla:1-business-day` / `sla:weekly`; WIP=1 within the launch project.
4. `site.scaffold` is inherited machinery ONLY — never GFTB design authority.

### Standing rules (operator-ruled; violations are defects)

- The bus is **permanently parked** — motion copy is a defect (banned-phrase
  gate stays).
- Vocabulary: **application** (not enrollment); **operator mapping at pilot
  intake** (not ingest/catalog); `steward` is deliberately absent — never
  reintroduce it.
- Maine solicitation / TIN-3905 is **operator-only**: zero agent reads,
  reviews, or resources, ever.
- No form is ever exposed without the PoW/security stack, and never on the
  root page.
- Final public copy and frontmatter are **operator-authored**; agent-drafted
  text ships only as `published: false` TODO drafts.
