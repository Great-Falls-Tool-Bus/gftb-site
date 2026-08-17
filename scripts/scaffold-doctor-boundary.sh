#!/usr/bin/env bash
# Authority-boundary audit for a Tinyland static spoke (or scaffold).
#
# Surfaces violations of the rules that should NEVER drift in a spoke:
#  - .bazelrc.flywheel has no remote_cache= or remote_executor= lines.
#  - flake.nix has no hard-coded secrets or token paths.
#  - .github/workflows/*.yml do not invoke Cloudflare API mutations directly.
#  - package.json does not range-pin in-house @tummycrypt/* or @tinyland/*.
#  - every backend.tf declares generic S3 state that is endpoint-free and
#    credential-free (TIN-2408/TIN-2406, 2026-07-29 correction: provider
#    selection — RustFS vs MinIO vs Garage — is owner-overlay/runtime
#    authority, never a source-level binding, so the scan is provider-neutral).
#  - No browser/edge runtime fetch of tinyland.dev from src/.
#
# The backend.tf scan is comment-aware HCL: `#` and `//` line comments and
# `/* ... */` block comments are stripped with string-literal awareness before
# matching, so inert commented-out wiring is legal while live wiring — even
# with a trailing comment on the same line — still fails.
#
# `--self-test` runs the checker against the fixtures under
# tests/fixtures/scaffold-doctor-boundary/ and fails closed: a missing fixture
# tree, or zero clean-*/violation-* fixtures, is itself a failure. The
# Justfile `scaffold-doctor` recipe runs it before the real audit (same
# pattern as validate-substrate-boundary.py --self-test) so a parser that can
# no longer see a positive can never certify the tree.
#
# Exit 0 if clean, 1 if any P0/FAIL surfaced. WARNs do not fail the run.

set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

# Comment-aware scan of one backend.tf: strips HCL comments (string-aware),
# then flags hard-coded endpoint keys and credential keys. Prints one line per
# violation; exit 0 clean, 1 violation(s).
scan_backend_file() {
  python3 - "$1" <<'PY'
import re
import sys

path = sys.argv[1]
with open(path, encoding="utf-8", errors="replace") as fh:
    src = fh.read()

# Strip HCL comments with string-literal awareness: '#' or '//' to end of
# line and '/* ... */' blocks are comments, except inside a quoted string.
out = []
i = 0
n = len(src)
in_string = False
while i < n:
    ch = src[i]
    if in_string:
        if ch == "\\" and i + 1 < n:
            out.append(src[i : i + 2])
            i += 2
            continue
        if ch == '"':
            in_string = False
        out.append(ch)
        i += 1
        continue
    if ch == '"':
        in_string = True
        out.append(ch)
        i += 1
        continue
    if ch == "#" or src[i : i + 2] == "//":
        while i < n and src[i] != "\n":
            i += 1
        continue
    if src[i : i + 2] == "/*":
        end = src.find("*/", i + 2)
        # Preserve newlines so violation line numbers stay honest.
        block = src[i:] if end == -1 else src[i : end + 2]
        out.append("\n" * block.count("\n"))
        i = n if end == -1 else end + 2
        continue
    out.append(ch)
    i += 1

stripped = "".join(out)

violations = []
for lineno, line in enumerate(stripped.splitlines(), start=1):
    # Endpoint wiring: legacy `endpoint = ...`, modern `endpoints = {...}` /
    # `endpoints {` block. Endpoint selection is env/operator authority.
    if re.search(r'(^|\s)endpoints?\s*[={]', line):
        violations.append((lineno, "hard-codes a state endpoint (endpoint selection is env/operator authority)"))
    # Credential wiring: state credentials never live in source.
    if re.search(r'(^|\s)(access_key|secret_key)\s*=', line):
        violations.append((lineno, "hard-codes a state credential (credentials are env/operator authority)"))

for lineno, msg in violations:
    print(f"line {lineno}: {msg}")

sys.exit(1 if violations else 0)
PY
}

# Fail-closed fixture self-test: every clean-* fixture must scan clean, every
# violation-* fixture must scan as a violation, and an empty or missing
# fixture set is a failure (a suite that can vanish silently gates nothing).
if [ "${1:-}" = "--self-test" ]; then
  fixture_root="tests/fixtures/scaffold-doctor-boundary"
  st_fail=0
  clean_seen=0
  violation_seen=0
  if [ ! -d "$fixture_root" ]; then
    echo "SELF-TEST FAIL | fixture tree $fixture_root is missing"
    exit 1
  fi
  for dir in "$fixture_root"/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    fixture="$dir/backend.tf"
    if [ ! -f "$fixture" ]; then
      echo "SELF-TEST FAIL | $name has no backend.tf"
      st_fail=1
      continue
    fi
    case "$name" in
      clean-*)
        clean_seen=$((clean_seen + 1))
        if out="$(scan_backend_file "$fixture")"; then
          echo "SELF-TEST PASS | $name scans clean"
        else
          echo "SELF-TEST FAIL | $name should scan clean but was flagged:"
          printf '%s\n' "$out" | sed 's/^/                 /'
          st_fail=1
        fi
        ;;
      violation-*)
        violation_seen=$((violation_seen + 1))
        if out="$(scan_backend_file "$fixture")"; then
          echo "SELF-TEST FAIL | $name should be flagged but scanned clean"
          st_fail=1
        else
          echo "SELF-TEST PASS | $name is flagged"
        fi
        ;;
      *)
        echo "SELF-TEST FAIL | $name is neither clean-* nor violation-* (verdict must be encoded in the name)"
        st_fail=1
        ;;
    esac
  done
  if [ "$clean_seen" -eq 0 ] || [ "$violation_seen" -eq 0 ]; then
    echo "SELF-TEST FAIL | need at least one clean-* and one violation-* fixture (found $clean_seen clean, $violation_seen violation)"
    st_fail=1
  fi
  echo ""
  if [ "$st_fail" -ne 0 ]; then
    echo "SELF-TEST SUMMARY: FAIL"
    exit 1
  fi
  echo "SELF-TEST SUMMARY: PASS ($clean_seen clean, $violation_seen violation fixtures)"
  exit 0
fi

fail_count=0
warn_count=0

check_fail() {
  local msg="$1"
  echo "FAIL | $msg"
  fail_count=$((fail_count + 1))
}

check_warn() {
  local msg="$1"
  echo "WARN | $msg"
  warn_count=$((warn_count + 1))
}

check_pass() {
  echo "PASS | $1"
}

# .bazelrc.flywheel must be endpoint-free
if [ -f .bazelrc.flywheel ]; then
  if grep -E '^[^#]*--remote_cache=' .bazelrc.flywheel >/dev/null 2>&1; then
    check_fail ".bazelrc.flywheel hard-codes remote_cache (must come from env)"
  elif grep -E '^[^#]*--remote_executor=' .bazelrc.flywheel >/dev/null 2>&1; then
    check_fail ".bazelrc.flywheel hard-codes remote_executor (must come from env)"
  else
    check_pass ".bazelrc.flywheel is endpoint-free"
  fi
fi

# flake.nix must not hard-code secrets
if [ -f flake.nix ]; then
  if grep -E '(api[_-]?key|token|secret|password)\s*=\s*"[^"]+' flake.nix >/dev/null 2>&1; then
    check_fail "flake.nix appears to hard-code a secret/token literal"
  else
    check_pass "flake.nix has no obvious secret literals"
  fi
fi

# Workflows must not directly mutate Cloudflare (DNS/Access/Tunnel)
if compgen -G ".github/workflows/*.yml" >/dev/null; then
  if grep -rlE '(api\.cloudflare\.com/client/v4/(zones|accounts).*/(dns_records|access|tunnels))' .github/workflows/ 2>/dev/null | head -1 >/dev/null; then
    check_fail "a workflow appears to call Cloudflare mutation endpoints directly — defer to the declared infrastructure owner"
  else
    check_pass "no direct Cloudflare mutation in workflows"
  fi
fi

# package.json: in-house deps must be exact-pinned (no ^ or ~)
if [ -f package.json ]; then
  bad="$(python3 - <<'PY'
import json, sys
try:
    pkg = json.load(open("package.json"))
except Exception:
    sys.exit(0)
bad = []
for section in ("dependencies", "devDependencies", "peerDependencies"):
    for name, ver in (pkg.get(section) or {}).items():
        if name.startswith("@tummycrypt/") or name.startswith("@tinyland/"):
            if isinstance(ver, str) and (ver.startswith("^") or ver.startswith("~")):
                bad.append(f"{name}={ver}")
for b in bad:
    print(b)
PY
)"
  if [ -n "$bad" ]; then
    while IFS= read -r dep; do
      check_fail "package.json range-pins in-house dep: $dep (must be exact)"
    done <<<"$bad"
  else
    check_pass "package.json in-house deps are exact-pinned"
  fi
fi

# Tofu state declarations stay endpoint-free and credential-free. Provider
# selection (RustFS/MinIO/Garage/...) is owner-overlay/runtime authority, not
# a source-level binding (TIN-2408/TIN-2406 correction 2026-07-29), so the
# scan is provider-neutral and comment-aware: inert commented-out wiring is
# legal, live wiring fails. Every backend.tf in the tree is in scope — stacks
# live at e.g. tofu/stacks/<name>/backend.tf, not only tofu/backend.tf. The
# self-test fixture tree is excluded: its violation fixtures are violations
# by design.
while IFS= read -r backend; do
  rel="${backend#./}"
  if out="$(scan_backend_file "$backend")"; then
    check_pass "$rel state declaration is endpoint-free and credential-free (generic S3; endpoint/credentials from operator/env)"
  else
    while IFS= read -r violation; do
      check_fail "$rel $violation"
    done <<<"$out"
  fi
done < <(find . -name backend.tf -type f -not -path './.git/*' -not -path './node_modules/*' -not -path './.direnv/*' -not -path './tests/fixtures/scaffold-doctor-boundary/*' | sort)

# No runtime fetch of tinyland.dev from src/ (browser/edge)
if [ -d src ]; then
  if grep -rE 'fetch\(\s*["'"'"']https?://tinyland\.dev' src/ 2>/dev/null | head -1 >/dev/null; then
    check_fail "src/ contains a runtime fetch of tinyland.dev — spokes are static; use checked-in snapshots"
  else
    check_pass "src/ has no runtime tinyland.dev fetch"
  fi
fi

# Skeleton pin check
if [ -f package.json ]; then
  sk="$(python3 -c "import json; pkg=json.load(open('package.json')); print((pkg.get('dependencies') or {}).get('@skeletonlabs/skeleton',''))")"
  if [ -n "$sk" ] && [ "$sk" != "4.15.2" ]; then
    check_warn "@skeletonlabs/skeleton=$sk (scaffold canonical: 4.15.2)"
  elif [ -n "$sk" ]; then
    check_pass "@skeletonlabs/skeleton pinned at 4.15.2"
  fi
fi

echo ""
echo "SUMMARY: $fail_count FAIL, $warn_count WARN"

exit $((fail_count > 0))
