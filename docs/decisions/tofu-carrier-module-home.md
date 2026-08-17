# Tofu carrier module home is site.scaffold

- Status: ratified — operator ruling R0, interview 2026-08-07 ("site.scaffold,
  amend repo.json").
- Original date: 2026-08-07.
- Linear: TIN-2030 (carrier module lane); TIN-489 (production-convergence
  doctrine).
- Evidence base: blahaj `docs/agent-notes/2026-08-07-lockstep-lane2-enforcement-matrix.md`
  (blahaj PR #1275, branch `docs/lockstep-review-20260807`).

> Path pointers corrected 2026-08-08: PR #129 landed after this ruling was
> written and renamed the doctrine and module to `converge-agent` /
> `converge_agent`. The ruling's substance is unchanged; only the names below
> were updated to the post-rename reality.

The source of the converge-agent carrier module lives in this repository. The
doctrine home is [docs/patterns/converge-agent.md](../patterns/converge-agent.md);
the module source (`modules/converge_agent/`) landed via PR #129,
owned by its repair lane. No other repository is the module's home, and in
particular `tinyland-inc/GloriousFlywheel` is not: per the GloriousFlywheel
product razor, GloriousFlywheel is the Nix+Bazel cache/RBE flywheel, and it
carries no `tofu/modules/converge-agent`.

`tinyland.repo.json` records the split truthfully in
`authorities.tofu_module_authority`: GloriousFlywheel remains the home of the
`spoke-*` modules this scaffold's `tofu/main.tf` composes; site.scaffold is the
home of the `converge_agent` module (named `tofu_agent_carrier` when this
ruling was written). The broader
`boundaries.owns_bazel_module_authority` flag stays `false` — it declares
Bazel (bzlmod) module authority, which this repo does not own
(`package_registry` is `tinyland-inc/bazel-registry`, cache/RBE authority is
GloriousFlywheel), and the v2 manifest schema pins it `false` for the
`static-spoke-scaffold` role.

## Coordination notes (no cross-repo edits from this lane)

Two merged pointers in the MMS estate currently disagree with this ruling.
They are recorded here for the MMS lane, which re-points them on its own
schedule; this lane makes no edits to MMS repositories.

1. **MMS `tofu-agent.tf:118` — `module_home_expected`.** The merged value
   points at `GloriousFlywheel//tofu/modules/converge-agent`, a module path
   that does not exist in GloriousFlywheel. Under this ruling the expected
   module home is site.scaffold's `converge_agent` module
   (`tinyland-inc/site.scaffold//modules/converge_agent`, landed via
   PR #129).

2. **MMS pr-env contract — `upstreamProducer.home`.** The merged value is
   `"gftb-core-runtime-ssot"`, a producer name Lane 1 traced to
   assistant-authored receipts with no ratified basis. Under this ruling the
   upstream producer home for the carrier module is
   `tinyland-inc/site.scaffold`.

3. **This repo's own v2 schema — `tofu_module_authority` consts.** The
   draft `docs/schemas/tinyland-repo-manifest.v2.schema.json` pinned
   `tofu_module_authority` to the pre-ruling value
   (`tinyland-inc/GloriousFlywheel`) in three places. Left unamended, any
   future migration of the manifest to `schema_version: 2` would have
   silently reverted this ruling at validation time. The three consts are
   updated in this change to pin the ruling's split value exactly, so a v2
   migration *enforces* the ruling instead of undoing it.
