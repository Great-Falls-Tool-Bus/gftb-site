# Great Falls Tool Bus public site

This repository builds the public apex website for the Great Falls Tool Bus
in Lewiston and Auburn, Maine. It holds page copy, goals, and build 
logs. SvelteKit produces static files with `adapter-static`.

Member accounts, payments, mail services, and deployment belong to other
repositories. The contact form sends requests to the `forms.latoolb.us` service.

Jess's internal tooling and the Linear system used to manage this work are
presently private.  Infrastructure is provided by Tinyland,
Inc.  GFTB is an alpha adopter of the GloriousFlywheel build system. 

## Start work

You need Git, Nix, and GitHub access.  Clone and
enter the pinned Nix shell. Then use Just for repository operations:

```bash
git clone git@github.com:Great-Falls-Tool-Bus/gftb-site.git
cd gftb-site
nix develop
just setup
just dev
```

`just setup` installs the locked dependencies. `just dev` starts the development
server. Run `just` to list all recipes. Do not run package or build tools
directly. Nix supplies the tools; the Justfile supplies the commands.

| Task | Command |
| --- | --- |
| Run unit tests | `just test-unit` |
| Check repository contracts | `just conformance` |
| Run the full validation suite | `just check` |
| Build and scan the static site | `just build` |
| Update the daily-log manifest | `just log-manifest-build` |
| Update the goals manifest | `just goals-manifest-build` |
| Update page source links | `just source-map-build` |

The full validation suite includes browser tests that require GF's supplied
Chromium. Local results do not replace a refused remote action or prove a
deployment. `just build` writes to `build/` and refuses an existing destination.
`just entrypoint-contract` and `just repo-manifest-validate` are compatibility
names for `just conformance`.

## Variables and credentials

Content editing does not require a site `.env` file. Keep private GitHub access
in your account's credential configuration. Never commit credentials or put
them in site content, build output, or PR text.

| Name | When it is needed |
| --- | --- |
| `BASE_PATH` | Optional build prefix. Leave it unset for the apex site. |
| `BUILD_COMMIT_SHA`, `BUILD_COMMIT_REF` | The candidate publisher supplies the exact source commit and ref. Ordinary development may use the default unknown stamp. |
| `GFTB_LEAK_SCAN_DENY` | Optional comma-separated private literals for `just leak-scan`. Supply them privately; never commit the values. |
| `GHCR_USER`, `GHCR_TOKEN` | Candidate publication only. The workflow uses the GitHub actor and its temporary `GITHUB_TOKEN`. These are not developer setup inputs. |

Deployment credentials belong to `great-falls-tool-bus-infra`. Its attended
release uses `WEB_APPLY_SHA` and `WEB_APPLY_IMAGE` for the source and image
digest, and `WEB_APPLY_KUBECONFIG` for apply access. Separate proof access uses
`WEB_RELEASE_KUBECONFIG`. These kubeconfigs must be private, operator-owned
mode-0600 files outside every Git repository. A gated served check also needs
`CF_ACCESS_COOKIE_JAR` with the same private file custody. See the
[owner release runbook](https://github.com/Great-Falls-Tool-Bus/great-falls-tool-bus-infra/blob/main/docs/runbooks/oncluster-web-cutover.md)
for the full input list and checks. Do not copy those credentials into this
repository or use apply access as independent proof access.

## Source, publication, and deployment

The current source declares two GF actions: `validate` runs the registered
checks, and `site-build` requests the scanned deployment bundle. See
[the CI contract](docs/CI-SCHEMA.md) for their exact targets and output rules.

The existing candidate workflow calls `just container-image-publish` on Linux.
It packages the static build as
`ghcr.io/great-falls-tool-bus/gftb-site:sha-<40-character-sha>`. It does not
deploy. The release lane may make this web image package publicly
readable after review and must prove a digest pull before cutover. 

The infra repository owns the existing attended release: select the reviewed
source and digest, apply them, and read back the running and served site.
Automatic GF deployment from `main` to production is still pending. A source
merge or image push alone does not prove that production serves that version.

## Content and licensing

Static build logs live in `src/content/log/`. Use only the frontmatter fields allowed
by [the content contract](AGENTS.md#public-content-boundary), including its
optional image group. Follow [the content guide](docs/content-train.md) for the
review process. Only `published: true` entries enter the public manifest.
Unpublished drafts are still public build inputs: they must contain no private
text, and the output scan checks that their content does not ship. Keep tracker
IDs, PR numbers, commit IDs, and private operational notes out of public logs.

Software uses the zlib license. GFTB writing uses CC BY-SA 4.0. Third-party
credits are in [NOTICE](NOTICE) and [the attribution record](docs/attribution.md).
