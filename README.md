# Great Falls Tool Bus public site

This public repository builds the apex website for the Great Falls Tool Bus
in Lewiston and Auburn, Maine. It holds page copy, goals, and build 
logs. SvelteKit produces static files with `adapter-static`.
Member accounts, payments, mail services, and deployment belong to other
repositories. The contact form sends requests to the `forms.latoolb.us` service.

`just` is the only entrypoint. Work on your own fork, inside the pinned Nix shell:

    gh repo fork Great-Falls-Tool-Bus/gftb-site --clone --remote
    cd gftb-site && nix develop
    just setup   # installs the shared hooks and links the Bazel-built packages
    just dev     # development server; `just` lists every recipe
    just check         # the full local suite
    just gate-deploy   # the merge gate, on a Linux lab host

The contract is [CONTRIBUTING.md](CONTRIBUTING.md) and the standing rules are [docs/operating-rules.md](docs/operating-rules.md).
Commands, variables, credentials, publication and deployment are in [docs/development.md](docs/development.md).
Public log entries follow [the content contract](docs/operating-rules.md#public-content-boundary) and [the content guide](docs/content-train.md). Never commit credentials.
Owner release runbooks are in [great-falls-tool-bus-infra](https://github.com/Great-Falls-Tool-Bus/great-falls-tool-bus-infra/tree/main/docs/runbooks). Decisions are in [meta](https://github.com/Great-Falls-Tool-Bus/meta).
Infrastructure is provided by Tinyland, Inc. GFTB is an alpha adopter of the GloriousFlywheel build system.

Software uses the zlib license. GFTB writing uses CC BY-SA 4.0. Third-party
credits are in [NOTICE](NOTICE) and [the attribution record](docs/attribution.md).
