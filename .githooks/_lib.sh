# shellcheck shell=bash
# shellcheck disable=SC2034 # variables are used by the hooks that source this file
# Shared helpers for the Great Falls Tool Bus git hooks.
#
# Canonical copy: meta steering/githooks/. Mirror: the organization .github
# repository, githooks/. Every repository carries a byte-identical .githooks/
# and `just hooks-check` compares it with the mirror.
#
# Plain bash and git only, compatible with bash 3.2. Every refusal or warning
# prints three lines: what happened, the CONTRIBUTING.md section that explains
# the rule, and the exact command that fixes it. The text is written for a
# person or an agent reading stderr.

GFTB_CONTRIBUTING="https://github.com/Great-Falls-Tool-Bus/.github/blob/main/CONTRIBUTING.md"

# Characters built from bytes so these sources contain none of them.
GFTB_EM_DASH="$(printf '\342\200\224')"
GFTB_ROBOT="$(printf '\360\237\244\226')"

GFTB_REFUSED=0

gftb_refuse() {
  # $1 what was refused, $2 CONTRIBUTING.md section, $3 fix command
  printf 'gftb-hooks: REFUSED: %s\n' "$1" >&2
  printf 'gftb-hooks:   rule: CONTRIBUTING.md, section "%s" (%s)\n' "$2" "$GFTB_CONTRIBUTING" >&2
  printf 'gftb-hooks:   fix:  %s\n' "$3" >&2
  GFTB_REFUSED=1
}

gftb_warn() {
  # $1 what looks wrong, $2 CONTRIBUTING.md section, $3 fix command
  printf 'gftb-hooks: warning: %s\n' "$1" >&2
  printf 'gftb-hooks:   rule: CONTRIBUTING.md, section "%s" (%s)\n' "$2" "$GFTB_CONTRIBUTING" >&2
  printf 'gftb-hooks:   fix:  %s\n' "$3" >&2
}

# Print the message body without comment lines and without anything below a
# `git commit --verbose` scissors line.
gftb_message_text() {
  sed -e '/^# -\{1,\} >8 -\{1,\}$/,$d' -e '/^#/d' "$1"
}

# Exit 0 when the message text on stdin carries AI attribution, printing the
# offending line. Human Co-Authored-By trailers pass.
gftb_ai_attribution_line() {
  local text first
  text="$(cat)"
  first="$(printf '%s\n' "$text" | sed -n '/[^[:space:]]/{p;q;}')"
  if printf '%s\n' "$first" | grep -iqE '^[[:space:]]*\[codex\]'; then
    printf '%s\n' "$first"
    return 0
  fi
  printf '%s\n' "$text" | grep -m1 -iE '^[[:space:]]*co-authored-by:.*(claude|codex|copilot|gpt|gemini|anthropic\.com|openai\.com)' && return 0
  printf '%s\n' "$text" | grep -m1 -E '^[[:space:]]*[Cc][Oo]-[Aa][Uu][Tt][Hh][Oo][Rr][Ee][Dd]-[Bb][Yy]:(.*[^[:alnum:]])?AI([^[:alnum:]]|$)' && return 0
  printf '%s\n' "$text" | grep -m1 -iE 'generated with' && return 0
  printf '%s\n' "$text" | grep -m1 -F "$GFTB_ROBOT" && return 0
  return 1
}

# Chain the matching executable hook in the global core.hooksPath once.
# $1 names the hook. $2 names the file to replay on stdin, or is empty.
# Forward the remaining arguments to the hook.
gftb_chain() {
  local hook="$1" input="$2" global here there owner
  shift 2
  [ -z "${GFTB_HOOKS_CHAINED:-}" ] || return 0
  export GFTB_HOOKS_CHAINED=1
  global="$(git config --global --type=path --get core.hooksPath 2>/dev/null || true)"
  here="$(cd "$(dirname "$0")" && pwd -P)" || return 1
  there=""
  if [ -n "$global" ]; then
    there="$(cd "$global" 2>/dev/null && pwd -P)" || there=""
  fi
  if [ -n "$there" ] && [ "$here" != "$there" ] && [ -f "$there/$hook" ] && [ -x "$there/$hook" ]; then
    if [ -n "$input" ]; then
      "$there/$hook" "$@" < "$input" || return $?
    else
      "$there/$hook" "$@" || return $?
    fi
    # A global hook owns Huskycat unless the contributor selects the repository.
    owner="$(git config --get gftb.huskycatOwner || true)"
    [ "$owner" = repo ] || return 0
  fi
  case "$hook" in
    pre-commit|commit-msg)
      if command -v huskycat >/dev/null 2>&1; then
        huskycat hook "$hook" "$@" --complete-staged || gftb_warn "huskycat hook $hook failed" "Install the hooks" "huskycat spec verify"
      else
        gftb_warn "Huskycat is missing from PATH" "Install the hooks" "command -v huskycat"
      fi
      ;;
  esac
}

# Print the anchored extended regular expression for a tooling-paths.txt
# pattern. `*` and `?` stay inside one path segment, and a leading `**/` lets
# the rest start at any depth. A trailing `/` matches the bare name, such as a
# file or a symbolic link, and everything below it.
gftb_glob_ere() {
  local glob="$1" prefix='^' suffix='$' body
  case "$glob" in
    '**/'*) prefix='^(.*/)?'; glob="${glob#'**/'}" ;;
  esac
  case "$glob" in
    */) suffix='(/|$)'; glob="${glob%/}" ;;
  esac
  # shellcheck disable=SC2016 # sed expressions, not shell expansions
  body="$(printf '%s\n' "$glob" | sed -e 's/[].[^$()+{}|\\]/\\&/g' -e 's|\*|[^/]*|g' -e 's|?|[^/]|g')"
  printf '%s%s%s\n' "$prefix" "$body" "$suffix"
}

# Match repository paths against tooling-paths.txt, ignoring case.
# $1 names the list file and $2 the repository. Paths arrive on stdin, one per
# line. Prints one line per denied path: path, rule and status, separated by
# tabs. Status is `hit`, or `allowed` and the ticket when an allow entry names
# that exact path. Returns 2 when the list is missing or malformed.
gftb_tooling_hits() {
  local list="$1" repo work kind arg ticket reason scope pattern ere line=0 bad=0 path key
  repo="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
  if [ ! -f "$list" ]; then
    printf 'gftb-hooks: path list not found: %s\n' "$list" >&2
    return 2
  fi
  work="$(mktemp -d "${TMPDIR:-/tmp}/gftb-paths.XXXXXX")" || return 2
  cat > "$work/paths"
  : > "$work/allow"
  : > "$work/out"
  while read -r kind arg ticket reason; do
    line=$((line + 1))
    case "$kind" in
      "" | "#"*) continue ;;
      deny)
        if [ -z "$arg" ] || [ -n "$ticket" ]; then
          printf 'gftb-hooks: %s line %s: deny takes one pattern\n' "$list" "$line" >&2
          bad=1
        fi
        ;;
      allow)
        case "$arg" in
          ?*:?*) ;;
          *) arg="" ;;
        esac
        case "$arg" in
          *'*'* | *'?'* | *'['* | */) arg="" ;;
        esac
        # A `..` segment names no tracked path, so the entry admits nothing.
        case "/${arg#*:}/" in
          */../*) arg="" ;;
        esac
        if [ -z "$arg" ] || ! printf '%s\n' "$ticket" | grep -qE '^[A-Z][A-Z0-9]*-[0-9]+$' || [ -z "$reason" ]; then
          printf 'gftb-hooks: %s line %s: allow needs REPO:PATH, a ticket such as TIN-1234 and a reason\n' "$list" "$line" >&2
          bad=1
        else
          printf '%s:%s\t%s\n' "$(printf '%s' "${arg%%:*}" | tr '[:upper:]' '[:lower:]')" "${arg#*:}" "$ticket" >> "$work/allow"
        fi
        ;;
      *)
        printf 'gftb-hooks: %s line %s: unknown entry %s\n' "$list" "$line" "$kind" >&2
        bad=1
        ;;
    esac
  done < "$list"
  if [ "$bad" -ne 0 ]; then
    rm -rf "$work"
    return 2
  fi
  while read -r kind arg ticket reason; do
    [ "$kind" = deny ] || continue
    pattern="$arg"
    case "$arg" in
      *:*)
        scope="$(printf '%s' "${arg%%:*}" | tr '[:upper:]' '[:lower:]')"
        pattern="${arg#*:}"
        [ "$scope" = "$repo" ] || continue
        ;;
    esac
    ere="$(gftb_glob_ere "$pattern")"
    grep -iE -- "$ere" "$work/paths" | while IFS= read -r path; do
      key="$repo:$path"
      ticket="$(awk -F'\t' -v k="$key" '$1 == k { print $2; exit }' "$work/allow")"
      if [ -n "$ticket" ]; then
        printf '%s\t%s\tallowed %s\n' "$path" "$arg" "$ticket"
      else
        printf '%s\t%s\thit\n' "$path" "$arg"
      fi
    done >> "$work/out"
  done < "$list"
  awk -F'\t' '!seen[$1]++' "$work/out"
  rm -rf "$work"
}
