#!/usr/bin/env bash

set -euo pipefail

base_path="${BASE_PATH:-}"
if [[ -n "${base_path}" && "${base_path}" != /* ]]; then
  echo "BASE_PATH must be empty or begin with '/': ${base_path}" >&2
  exit 1
fi
if [[ "${base_path}" == *$'\n'* || "${base_path}" == *$'\r'* || "${base_path}" == *$'\t'* || "${base_path}" == *' '* ]]; then
  echo "BASE_PATH must not contain whitespace" >&2
  exit 1
fi

commit_sha="${BUILD_COMMIT_SHA:-${GITHUB_SHA:-}}"
if [[ -z "${commit_sha}" ]]; then
  commit_sha="$(git rev-parse HEAD 2>/dev/null || true)"
fi
commit_sha="${commit_sha:-unknown}"
if [[ "${commit_sha}" != "unknown" && ! "${commit_sha}" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
  echo "build commit must be a hexadecimal revision or 'unknown'" >&2
  exit 1
fi

# Footer build provenance (old apex #140 port, src/lib/build-info.ts): only an
# EXPLICITLY supplied commit identity (BUILD_COMMIT_SHA or GITHUB_SHA — CI and
# publish invocations) becomes public bytes; the local `git rev-parse` fallback
# above stays build-internal, so a local build renders no provenance line.
# Truncated to 7 chars HERE, before Vite can inline it: the leak-scan gate
# rejects any 40-hex string in the shipped artifact.
public_sha="${BUILD_COMMIT_SHA:-${GITHUB_SHA:-}}"
public_sha="${public_sha:0:7}"

printf 'STABLE_BUILD_BASE_PATH %s\n' "${base_path:-__EMPTY__}"
printf 'STABLE_BUILD_COMMIT_SHA %s\n' "${commit_sha}"
printf 'STABLE_PUBLIC_BUILD_SHA %s\n' "${public_sha:-__ABSENT__}"
