# Great Falls Tool Bus public site

This repository holds the pages, goals and build logs for the Great Falls Tool Bus in Lewiston and Auburn, Maine.
SvelteKit builds the static site. The contact form sends requests to `forms.latoolb.us`.

Fork the repository and start the development server in its pinned Nix shell.

```sh
gh repo fork Great-Falls-Tool-Bus/gftb-site --clone --remote
cd gftb-site
nix develop
just setup
just dev
```

Content editing needs no site `.env` file. Follow the [content guide](docs/content-train.md) for log entries.
Run `just check` for the full local suite. The Linux lab merge gate is `just gate-deploy`.
The [Justfile](Justfile) lists the recipes. Submit signed changes from your fork under the [contribution contract](CONTRIBUTING.md) and [standing rules](docs/operating-rules.md).

Tinyland, Inc. provides the infrastructure. GFTB is an alpha adopter of the GloriousFlywheel build system.
The [owner release runbook](https://github.com/Great-Falls-Tool-Bus/great-falls-tool-bus-infra/blob/main/docs/runbooks/oncluster-web-cutover.md) covers deployment and credential custody.

Software uses the zlib license. GFTB writing uses CC BY-SA 4.0. Third-party
credits are in [NOTICE](NOTICE) and [the attribution record](docs/attribution.md).
