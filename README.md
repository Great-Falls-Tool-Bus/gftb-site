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
  Entries with `published: true` enter the generated public manifest. An
  operator-pending `published: false` draft may remain in `src/content/log/`;
  the manifest excludes it and the built-output leak scan verifies that its
  content did not ship. Drafts are still scanned and must contain no private
  text.
- Internal tracker IDs, PRs, SHAs, repo pointers, and private locations never
  appear in public logs.

## Stack and commands

This spoke follows the Tinyland repository contract: Just is the only operator
entrypoint, Nix supplies the shell, and Bazel/GloriousFlywheel provide the
finite build and test graph. This repo carries an explicit Skeleton 5.0.0
exception based on the proven `jesssullivan.github.io` Svelte 5 pattern.

```bash
just check
just build
```

Both commands call the image-custodied GF client using this checkout's exact
source SHA and checked-in ActionPlan. Missing client, identity, App, overlay,
or remote execution authority fails closed; there is no local build/test path.
`just build` writes qualified-result audit files naming the exact CAS-backed
deployment bundle into a new `.gf-site-build-result/` directory. Those files
do not materialize the bundle or confer publication authority. Pass a different
new absolute result directory for another export; existing results are not
overwritten.

The GF-I09 publisher, not an application-repository workflow or local Nix
build, composes and publishes the qualified layer with the runtime base.
Publication does not itself select or deploy the image for production.
`just setup` and the Nix shell remain source-editing conveniences, not
prerequisites for remote execution or substitutes for its authority.

The source repository remains private. After review, the operator release lane
may make only this public web image package anonymous-readable and must prove a
digest pull before cutover; this repo carries no registry pull credentials.

## Content and licensing

Public logs live in `src/content/log/`. Software is licensed under zlib; GFTB
written content is CC BY-SA 4.0. Third-party visual provenance is recorded in
`NOTICE` and `docs/attribution.md`.
