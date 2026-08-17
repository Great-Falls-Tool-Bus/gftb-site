---
name: tinyland-scaffold-doctor
description: Audit a Tinyland repo for drift against the site.scaffold house-style contract. Reports a structured scorecard covering Justfile recipes, flake.nix toolchain, .gitleaks.toml rules, AGENTS.md / CLAUDE.md presence, tinyland.repo.json validity, .agents/skills/* presence and naming, .bazelrc / .bazelrc.flywheel shape (endpoint-free), Skeleton/Tailwind pins, snapshot ingestion recipes, lanes.json schema validity, and CI workflow inheritance from ci-templates. Use when onboarding to an unfamiliar sister site, debugging "why does CI fail here but not in scaffold", validating a spawn worked, or pre-merge before raising a PR that bumps the scaffold tag.
when_to_use: |
  Use when the user asks "is this site healthy", "does this match scaffold", "what's
  drifted", "audit conformance", or after running /tinyland-spawn-sister-site to
  verify the new spoke is house-style compliant. Also use proactively if you notice
  a sister site failing a check the scaffold passes — drift is the most common cause.
allowed-tools:
  - Read
  - Bash(just conformance)
  - Bash(just lanes-validate)
  - Bash(just repo-manifest-validate)
  - Bash(just inhouse-package-parity)
  - Bash(just secrets-scan-dir)
  - Bash(just bazel-graph)
  - Bash(jq *)
  - Bash(diff *)
  - Bash(git *)
  - Bash(grep *)
  - Bash(test *)
---

# Tinyland Scaffold Doctor

## What "drift" means

Drift is divergence between this repo and the scaffold tag it was spawned from.
The scaffold ships pinned versions (Skeleton 4.15.2, Tailwind v4 compat shim),
recipe shapes (`just check` / `just ci` / `just conformance`), schemas
(`docs/schemas/lanes.schema.json`, `tinyland-repo-manifest.schema.json`), and
authority boundaries (no Cloudflare creds in a spoke, no runtime broker fetches,
generic S3 state with runtime endpoint authority on the current RustFS substrate).
Drift erodes those guarantees silently — a spoke that
"works" today can fail conformance because a recipe was renamed, a flake input
was dropped, a Bazel registry entry was unpinned, or a Cloudflare token leaked
in.

Scaffold-doctor's job is to make drift visible.

## How to run it

Three layers, run in this order:

### Layer 1 — Existing checks (fast)

```bash
just conformance                # source checklist (docs/CI-SCHEMA.md §11)
just repo-manifest-validate     # tinyland.repo.json against the JSON Schema
just lanes-validate             # .github/lanes.json against schema
just inhouse-package-parity     # package.json versions == MODULE.bazel versions
just secrets-scan-dir           # gitleaks against working tree
just bazel-graph                # module-graph integrity proof
```

A green pass on all six is the floor, not the ceiling.

`just conformance` also runs a REPORT-ONLY Bazel-SSOT anti-pattern scan
(`scripts/check-bazel-ssot-report-only.py`, TIN-2672 phase 1; doctrine at
`docs/research/bazel-ssot-packaging-dogfooding-2026-07.md`). It WARNS only (it
never fails the check and never gates CI) on two anti-patterns so drift cannot
regrow silently before the fleet-wide flip to hard-fail:

1. An in-house `@tummycrypt/*`/`@tinyland/*` `package.json` dependency
   declared as a `workspace:*` specifier or a vendored tarball/producer-tree
   path, instead of an exact bazel-registry-pinned npm version (the
   mothership anti-dogfooding case the doctrine names).
2. A `pkg_tar`/container packaging Bazel target whose tags mix or omit
   pieces of the two disjoint packaging classes: `deployment-bundle-packaging`
   + `flywheel-eligible` (executor-safe) OR `container-image-and-push` +
   `gloriousflywheel-cache-only` + `no-remote-exec` (cache-only, never
   `flywheel-eligible`).

Treat any WARN from this scan as pre-drift signal: it is the shape of thing
that becomes a P0/FAIL once TIN-2672's follow-up flips it to hard-fail, so
raise a fix PR rather than waiting for the flip.

### Layer 2 — Scaffold-version drift (deep)

Compare this repo against the scaffold tag it was spawned from.

```bash
# 1. Identify the scaffold tag this repo inherits from.
SCAFFOLD_TAG="$(jq -r '.scaffold_tag // empty' tinyland.repo.json)"
# (If empty, fall back to the most-recent tinyland-inc/site.scaffold release.)

# 2. Fetch the scaffold at that tag into transient scratch (mktemp -d).
#    The clone is re-fetchable transient INPUT consumed by this procedure
#    only. The durable OUTPUT of the audit is the scorecard/report below —
#    persist it to the repo, a PR, or a git-tracked docs/ note; never leave
#    findings in the scratch dir (scratch/tmp dirs are wiped without warning).
DOCTOR_SCRATCH="$(mktemp -d)"
gh repo clone tinyland-inc/site.scaffold "$DOCTOR_SCRATCH/scaffold-$SCAFFOLD_TAG"
git -C "$DOCTOR_SCRATCH/scaffold-$SCAFFOLD_TAG" checkout "$SCAFFOLD_TAG"

# 3. Diff load-bearing files (run from the audited repo's root).
#    Surface (not auto-fix) drift.
for f in Justfile flake.nix .bazelrc .bazelrc.flywheel \
         .gitleaks.toml docs/CI-SCHEMA.md \
         docs/schemas/lanes.schema.json \
         docs/schemas/tinyland-repo-manifest.schema.json \
         docs/schemas/tinyland-repo-manifest.v2.schema.json \
         scripts/check-conformance.sh \
         scripts/gloriousflywheel-bazel.sh; do
  diff -u "$DOCTOR_SCRATCH/scaffold-$SCAFFOLD_TAG/$f" "$f" || true
done
```

Report each drift with: file, summary of change, likely cause (intentional
fork vs unintended drift), and whether to fold the scaffold's version back in.

### Layer 3 — Authority-boundary audit

These are the rules that should NEVER drift in a spoke:

- `tinyland.repo.json` `boundaries.owns_*` flags match the role.
- `.bazelrc.flywheel` has NO `remote_cache=` or `remote_executor=` lines.
- `flake.nix` has no hard-coded secrets or token paths.
- `.github/workflows/*.yml` do not invoke Cloudflare mutation or a generic
  application receiver. Product lifecycle belongs to the owner overlay.
- No `package.json` dependency on a non-exact in-house version
  (`^x.y.z` or `~x.y.z` are forbidden for `@tummycrypt/*` and `@tinyland/*`).
- `tofu/backend.tf` uses the `s3` backend type with **no hard-coded provider
  endpoint** (env/operator authority); the state substrate is **RustFS** — never
  Garage/MinIO (hallucinations).
- No browser/edge runtime fetch of `tinyland.dev` from a spoke (snapshots
  only, ingested at build time).

`grep` and small-script checks land each of these. Surface any violation as
**P0 drift** — the spoke is no longer house-style compliant in a way that may
silently corrupt the federation perimeter.

## Output format

Produce a scorecard, one row per check, in this shape:

```
PASS | check-name                      | (one-line evidence)
PASS | ...
WARN | flake.nix: missing git-cliff   | scaffold@v0.4.0 adds git-cliff to devShell
FAIL | .bazelrc.flywheel:23           | hard-codes remote_cache= (forbidden)
P0   | tofu/backend.tf:7              | hard-codes a provider state endpoint (forbidden — env authority)
```

Then a `SUMMARY:` line:

```
SUMMARY: 14 PASS, 2 WARN, 1 FAIL, 1 P0
```

Then a `NEXT STEPS:` block: ordered list of fixes, P0 first.

## When to suggest a scaffold-tag bump

If the doctor finds the scaffold is N+1 minor versions ahead and the spoke
is missing recipes the scaffold ships, suggest a scaffold-tag bump rather than
patching ad hoc. Bumps are coordinated by editing `tinyland.repo.json`'s
`scaffold_tag` (when that field exists) and re-running the spawn ritual's
post-creation steps minus the `gh repo create`.

## What this skill does NOT do

- It does not auto-fix drift. Drift fixes are PRs, not script outputs — they
  need human review.
- It does not enforce non-static-spoke rules on `tinyland.dev` or
  MassageIthaca-shaped app repos. Run `/tinyland-whoami` first to confirm the
  role before invoking this skill.
- It does not validate snapshot contents (signature, Pulse M1 shape) — that's
  what `just validate-static-projection` does. The doctor only verifies the
  recipe exists and is wired correctly.
