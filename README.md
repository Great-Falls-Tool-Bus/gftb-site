# Great Falls Tool Bus public site

The static public front door for the Great Falls Tool Bus in
Lewiston–Auburn, Maine. The site explains what the project is, what is happening
next, how to help, and publishes a small reviewed build log.

## Boundaries

- Static SvelteKit output (`adapter-static`); no runtime server.
- No auth, member records, payments, mail operations, private content, or
  infrastructure authority.
- The browser posts the public contact form to the separately operated
  `forms.latoolb.us` API, with an email fallback. This repo owns neither service.
- Daily logs are checked-in `.svx` documents. Their frontmatter is limited to
  `date`, `title`, `summary`, `tags`, `published`, and optional `updated`.
  Every file in `src/content/log/` must set `published: true`; drafts stay out
  of the public build input directory.
- Internal tracker IDs, PRs, SHAs, repo pointers, and private locations never
  appear in public logs.

## Stack and commands

This spoke follows the Tinyland repository contract: Just is the only operator
entrypoint, Nix supplies the shell, and Bazel/GloriousFlywheel provide the
finite build and test graph. This repo carries an explicit Skeleton 5.0.0
exception based on the proven `jesssullivan.github.io` Svelte 5 pattern.

```bash
direnv allow
just setup
just check
just build
```

`just build` materializes the deployable static site under `build/`.

`just container-image-publish` is a Linux CI-only entrypoint that publishes the
same static artifact as an immutable
`ghcr.io/great-falls-tool-bus/gftb-site:sha-<40-character-sha>` candidate. It
does not deploy or select the image for production.

The source repository remains private. After review, the operator release lane
may make only this public web image package anonymous-readable and must prove a
digest pull before cutover; this repo carries no registry pull credentials.

## Content and licensing

Public logs live in `src/content/log/`. Software is licensed under zlib; GFTB
written content is CC BY-SA 4.0. Third-party visual provenance is recorded in
`NOTICE` and `docs/attribution.md`.
