#!/usr/bin/env bash

set -euo pipefail
# Byte-wise regex ranges: [a-z] means ASCII a-z only, whatever the caller's
# locale, so this check agrees with TAILNET_PROBE_URL_RE in scripts/lib/leak-scan.mjs.
export LC_ALL=C

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
# (BUILD_COMMIT_SHA, from the lab-host just recipes and the publish lane). An
# unidentified build stamps the literal 'unknown', which is the absent-value
# vite.config.ts already documents for this channel ("otherwise they report
# unknown"), so a local `just build` renders no footer provenance line
# (src/lib/build-info.ts, the old apex #140 port). There is deliberately no
# `git rev-parse` fallback: a convenience identity here would become public
# bytes in the footer.
commit_sha="${BUILD_COMMIT_SHA:-}"
commit_sha="${commit_sha:-unknown}"
if [[ "${commit_sha}" != "unknown" && ! "${commit_sha}" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
  echo "build commit must be a hexadecimal revision or 'unknown'" >&2
  exit 1
fi

# Truncated to 7 chars HERE, at the source, before Vite can inline anything:
# the leak-scan gate rejects any 40-hex string in the shipped artifact, so
# the full form never crosses the stamp at all.
if [[ "${commit_sha}" != "unknown" ]]; then
  commit_sha="${commit_sha:0:7}"
fi

# Tailnet probe URL for the membership surface flag, which vite.config.ts reads
# as PUBLIC_TAILNET_PROBE_URL. It ships in the public bundle when set, but it
# is never committed: only a caller that exports it (the publish lane, or an
# operator build) carries it, and an unset value stamps the empty marker so
# the default build names no tailnet host. Bazel actions do not inherit the
# caller's environment, so this stable key is the one channel into the build.
# The shape is exactly https://<node>.<tailnet>.ts.net/<path>: no port, query,
# fragment or credentials. A malformed value is never echoed or stamped: the
# status command stamps the invalid marker instead and still succeeds, because
# it runs for every Bazel command and must not break unrelated targets. The two
# stamped consumers (scripts/bazel/build-metadata.mjs readers in //:build and
# //:scanned_build) fail on that marker.
probe_url="${PUBLIC_TAILNET_PROBE_URL:-}"
probe_url_re='^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z0-9]([a-z0-9-]*[a-z0-9])?\.ts\.net/[A-Za-z0-9._/-]*$'
if [[ -n "${probe_url}" && ! "${probe_url}" =~ ${probe_url_re} ]]; then
  echo "warning: PUBLIC_TAILNET_PROBE_URL is malformed (value not shown); //:build and //:scanned_build will fail until it is empty or https://<node>.<tailnet>.ts.net/<path>" >&2
  probe_url="__INVALID__"
fi

printf 'STABLE_BUILD_BASE_PATH %s\n' "${base_path:-__EMPTY__}"
printf 'STABLE_BUILD_COMMIT_SHA %s\n' "${commit_sha}"
printf 'STABLE_BUILD_TAILNET_PROBE_URL %s\n' "${probe_url:-__EMPTY__}"
