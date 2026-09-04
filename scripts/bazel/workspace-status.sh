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

# Commit identity is stamped ONLY from an explicitly supplied value
# (BUILD_COMMIT_SHA or GITHUB_SHA — CI and publish invocations). An
# unidentified build stamps the literal 'unknown', which is the absent-value
# vite.config.ts already documents for this channel ("otherwise they report
# unknown"), so a local `just build` renders no footer provenance line
# (src/lib/build-info.ts, the old apex #140 port). There is deliberately no
# `git rev-parse` fallback: a convenience identity here would become public
# bytes in the footer.
source_sha="${BUILD_COMMIT_SHA:-${GITHUB_SHA:-}}"
source_sha="${source_sha:-unknown}"
if [[ "${source_sha}" != "unknown" && ! "${source_sha}" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
  echo "build commit must be a hexadecimal revision or 'unknown'" >&2
  exit 1
fi
source_sha="${source_sha,,}"

# Truncated to 7 chars HERE, at the source, before Vite can inline anything:
# the leak-scan gate rejects any 40-hex string in the shipped artifact, so
# the full form never crosses the stamp at all.
commit_sha="${source_sha}"
if [[ "${source_sha}" != "unknown" ]]; then
  commit_sha="${source_sha:0:7}"
fi

printf 'STABLE_BUILD_BASE_PATH %s\n' "${base_path:-__EMPTY__}"
printf 'STABLE_BUILD_COMMIT_SHA %s\n' "${commit_sha}"
# The full identity is consumed only by //:deployment_source_marker after the
# public build has passed its leak scan. GF-I09 requires exactly 40 lowercase
# hex characters before the qualified application layer can materialize.
printf 'STABLE_BUILD_SOURCE_SHA %s\n' "${source_sha}"
