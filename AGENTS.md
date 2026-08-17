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
- `just build` produces the adapter-static site under `build/` through Bazel.
- `just check` runs secret, endpoint, conformance, entrypoint, formatting,
  typecheck, and unit-test gates.
- `just conformance` validates the live minimal-spoke contract.
- Skeleton and Skeleton Svelte are exact-pinned at `5.0.0`, following the
  proven Svelte 5 pattern in `jesssullivan.github.io`. Do not restore the
  Skeleton 4 compatibility shim.
- GloriousFlywheel is cache-first. Endpoints and credentials come only from
  the runtime environment. Do not create runners or hard-code cache/executor
  endpoints.
- Org ARC jobs use `tinyland-nix`; both reusable-workflow heavy and KVM inputs
  are explicitly mapped to that available class.

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
