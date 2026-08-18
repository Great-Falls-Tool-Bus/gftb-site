---
name: tinyland-static-spoke
description: Customize, review, or maintain the GFTB Tinyland static spoke. Use when changing AGENTS.md, README.md, SvelteKit static routes, reviewed SVX logs, contact-form presentation, lane metadata, sitemap/robots, or the public brand surface.
---

# GFTB static spoke

Read `AGENTS.md`, `docs/CI-SCHEMA.md`, `Justfile`, existing routes, and
`src/app.css` before changing the site.

This repository owns reviewed public content and an adapter-static artifact. A
browser may submit the public form to the separately owned contact API. The repo
does not own auth, member data, payments, mail, runtime APIs, infrastructure, or
deployment selection.

Public logs are checked-in `.svx` files whose frontmatter is limited to the
exact keys in `AGENTS.md`. Keep internal tracker/repository pointers, private
locations, member information, and operational notes out of public routes.
Public agent indexes and developer source maps are forbidden.

Lanes are CI metadata. An immutable candidate image is still not a deployment.
The external owner selects a digest, creates any review/production route,
proves the served head, and performs rollback. Do not add Cloudflare, cluster,
auth, payment, or mail credentials.

Use only `just <recipe>`. After changes, run the relevant content tests plus
`just source-map-check`, `just endpoint-check`, `just secrets-scan-dir`,
`just conformance`, `just check`, and `just build`.
