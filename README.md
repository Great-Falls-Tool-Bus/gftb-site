# Great Falls Tool Bus public site

This public repository builds the apex website for the Great Falls Tool Bus
in Lewiston and Auburn, Maine. It holds page copy, goals, and build logs.
SvelteKit produces static files with `adapter-static`.

Member accounts, payments, mail services, and deployment belong to other
repositories. The contact form sends requests to `forms.latoolb.us`.

Jess's internal tooling and Linear management system are presently private.
GloriousFlywheel infrastructure is provided by Tinyland, Inc.

## Start work

You need Git, Nix, and the provisioned GloriousFlywheel client for remote
checks. Clone the public source and enter the pinned Nix shell:

```bash
git clone https://github.com/Great-Falls-Tool-Bus/gftb-site.git
cd gftb-site
nix develop
just
just check
just build
```

Just is the entrypoint for repository operations. `just setup` installs locked
dependencies for editing source and running the content generators. Checks
and builds use the image-custodied GF client, this checkout's exact source
SHA, and its checked-in ActionPlan. Missing client or owner admission fails
closed. These recipes do not start a local development server or build.

| Task | Command |
| --- | --- |
| Run the registered validation suite | `just check` |
| Request the scanned deployment bundle | `just build` |
| Update the daily-log manifest | `just log-manifest-build` |
| Update the goals manifest | `just goals-manifest-build` |
| Update page source links | `just source-map-build` |

`just test-unit`, `just conformance`, `just lint`, and `just typecheck` select
the same remote validation suite. It includes finite Chromium acceptance
using GF's provisioned browser and the TinyVectors package proof. Those tests
do not establish a deployed preview or operator LOOK.

`just build` writes qualified-result audit files naming the exact CAS-backed
deployment bundle into a new `.gf-site-build-result/` directory. It does not
materialize the bundle or confer publication authority. Pass a different new
absolute result directory for another export; existing results are not
overwritten.

## Variables and credentials

Content editing needs no site `.env` file. Keep GitHub write access in your
account's credential configuration. Never commit credentials or put them in
site content, build output, or PR text.

The provisioned GF client and owner installation supply execution identity
and credentials. This repository does not load or store their values. GF
binds the exact source SHA to Bazel's `BUILD_EMBED_LABEL`; the source-marker
action produces the file consumed by Vite and the deployment bundle. A missing
or malformed marker fails the build. There is no unknown source stamp or
caller-supplied publication token in this repository's release path.

Deployment credentials and apply recipes belong to
`great-falls-tool-bus-infra`. Its
[owner release runbook](https://github.com/Great-Falls-Tool-Bus/great-falls-tool-bus-infra/blob/main/docs/runbooks/oncluster-web-cutover.md)
lists the attended release inputs and their private storage requirements.
Do not copy them here. Local shell variables do not replace GF admission or
an owner release transaction.

## Source, publication, and deployment

The September 9, 2026 operator decision made this source repository public
and superseded the earlier private-source restriction. GitHub files and pull
requests, including draft PRs, are publicly readable.

The source declares two GF actions: `validate` runs the registered checks,
and `site-build` requests the scanned deployment bundle. See
[the CI contract](docs/CI-SCHEMA.md) for exact targets and output rules.

GF-I09 composes and publishes the qualified application layer with its runtime
base. This repository has no separate candidate publisher or local image
constructor. Publication does not deploy an image. Infra owns source and
digest selection, apply, independent running and served readback, and rollback.
The runtime must serve the expected full source SHA at `/health.sha`.

These source definitions do not establish working automatic deployment from
`main` to production. A source merge, successful check, or image push alone
does not prove which version production serves.

## Content and licensing

Build logs live in `src/content/log/`. Use only the frontmatter fields allowed
by [the content contract](AGENTS.md#public-content-boundary), including its
optional image group. Follow [the content guide](docs/content-train.md) for the
review process. Only `published: true` entries enter the public manifest.

Draft PRs and `published: false` sources are public on GitHub. Those states
control website publication, not source privacy. Privacy and content checks
must finish before a draft is written. Keep private text, tracker IDs,
PR numbers, commit IDs, and private operational notes out of public logs.

Software uses the zlib license. GFTB writing uses CC BY-SA 4.0. Third-party
credits are in [NOTICE](NOTICE) and [the attribution record](docs/attribution.md).
