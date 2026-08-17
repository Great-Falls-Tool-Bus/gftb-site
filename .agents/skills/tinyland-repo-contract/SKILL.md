---
name: tinyland-repo-contract
description: Maintain the GFTB repository's predictable developer and agent contract: Just-only operations, a minimal Nix shell, gitleaks, Bazel graphability, scoped CI, live schemas, and delete-after-rewire contraction.
---

# GFTB repository contract

The root `AGENTS.md` wins. Use `just <recipe>` for every operation and
`nix develop` for the toolchain. Keep build, check, test, formatting, secret
scan, schema validation, and candidate publication discoverable from Just.
CI-relevant build and test work must also have finite Bazel targets.

Never commit secrets, endpoint credentials, decrypted data, kubeconfigs, cache
headers, or `.env` files. Gitleaks must cover both the working tree and history.

Do not commit one-off validation scripts. Promote a recurring decision into the
smallest live script plus a Just recipe or Bazel target. After rewiring all live
references, delete superseded notes, evidence, generated copies, schemas,
scripts, and workflows; Git history is recovery.

Completion requires `just --list`, manifest/lane validation, the endpoint and
source-map absence checks, gitleaks, conformance, relevant tests, and the build.
