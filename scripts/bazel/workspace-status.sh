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

printf 'STABLE_BUILD_BASE_PATH %s\n' "${base_path:-__EMPTY__}"
printf 'STABLE_BUILD_COMMIT_SHA %s\n' "${commit_sha}"
