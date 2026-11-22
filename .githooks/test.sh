#!/usr/bin/env bash
# Self-test for the Great Falls Tool Bus git hooks. Run by `just hooks-test`.
#
# Builds a throwaway repository under ${TMPDIR:-/tmp} with fixture commits
# (signed with a throwaway SSH key, unsigned, AI attribution, em dash, good and
# bad branch names), pushes to local bare repositories standing in for the
# organization remote and a fork, and asserts exit codes and warnings. The
# operator's own git configuration is never read: HOME and the global config
# point into the temporary directory, which is removed on exit. The real HOME
# is restored before that removal, because a home-root delete guard refuses to
# remove any ancestor of the current HOME.
set -euo pipefail

hooks="$(cd "$(dirname "$0")" && pwd -P)"
real_home="${HOME:-}"
work="$(mktemp -d "${TMPDIR:-/tmp}/gftb-hooks-test.XXXXXX")"
cleanup() {
  export HOME="$real_home"
  rm -rf "$work"
}
trap cleanup EXIT

export HOME="$work/home"
export GIT_CONFIG_GLOBAL="$work/gitconfig"
export GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE SSH_AUTH_SOCK GFTB_HOOKS_CHAINED || true
mkdir -p "$HOME" "$work/marks" "$work/global-hooks"

em="$(printf '\342\200\224')"
robot="$(printf '\360\237\244\226')"

# Vendor and GitHub addresses are assembled at run time so no source line
# carries a literal address outside the documentation domains; the public PII
# validators in every repository scan this file. The hooks still see the full
# address.
ai_vendor_domain=anthropic.com
ai_vendor_alt_domain=openai.com
github_domain=github.com
claude_addr="noreply@${ai_vendor_domain}"
codex_addr="codex@${ai_vendor_alt_domain}"
github_merge_addr="noreply@${github_domain}"

# A stand-in for a machine-wide hook layer; records that it was chained to.
for hook in pre-commit commit-msg; do
  printf '#!/usr/bin/env bash\n: > "%s/%s"\n' "$work/marks" "$hook" > "$work/global-hooks/$hook"
done
printf '#!/usr/bin/env bash\ncat > "%s/pre-push"\n' "$work/marks" > "$work/global-hooks/pre-push"
chmod +x "$work/global-hooks/"*

ssh-keygen -q -t ed25519 -N '' -C gftb-hooks-test -f "$work/signing"
git config --global user.name "Hook Test"
git config --global user.email "hook-test@example.org"
git config --global init.defaultBranch main
git config --global gpg.format ssh
git config --global user.signingkey "$work/signing"
git config --global commit.gpgsign true
git config --global core.hooksPath "$work/global-hooks"

passed=0
failed=0
out="$work/out"

# check NAME WANT_STATUS [--warns|--quiet|--refused|--any] -- COMMAND...
# WANT_STATUS 2 means exactly 2; any other nonzero value means any failure.
check() {
  local name="$1" want="$2" expect="$3" got
  shift 4
  set +e
  "$@" > "$out" 2>&1
  got=$?
  set -e
  local ok=1
  if [ "$want" = 0 ] && [ "$got" -ne 0 ]; then ok=0; fi
  if [ "$want" != 0 ] && [ "$got" -eq 0 ]; then ok=0; fi
  if [ "$want" = 2 ] && [ "$got" -ne 2 ]; then ok=0; fi
  case "$expect" in
    --warns) grep -q '^gftb-hooks: warning:' "$out" || ok=0 ;;
    --quiet) grep -q '^gftb-hooks:' "$out" && ok=0 ;;
    --refused) grep -q '^gftb-hooks: REFUSED:' "$out" && grep -q '^gftb-hooks:   fix:' "$out" || ok=0 ;;
  esac
  if [ "$ok" -eq 1 ]; then
    passed=$((passed + 1))
    printf 'ok   %s\n' "$name"
  else
    failed=$((failed + 1))
    printf 'FAIL %s (exit %s, wanted %s, %s)\n' "$name" "$got" "$want" "$expect"
    sed 's/^/     | /' "$out"
  fi
}

mark_check() {
  local name="$1" file="$2"
  if [ -f "$work/marks/$file" ]; then
    passed=$((passed + 1))
    printf 'ok   %s\n' "$name"
  else
    failed=$((failed + 1))
    printf 'FAIL %s (global %s hook did not run)\n' "$name" "$file"
  fi
}

out_has() {
  if grep -qF -- "$2" "$out"; then
    passed=$((passed + 1))
    printf 'ok   %s\n' "$1"
  else
    failed=$((failed + 1))
    printf 'FAIL %s\n' "$1"
  fi
}

repo="$work/repo"
git init -q "$repo"
cd "$repo"
git config core.hooksPath "$hooks"

commit() { git commit -q --allow-empty "$@"; }

# commit-msg and pre-commit
printf 'plain text\n' > a.txt
git add a.txt
check "signed conventional commit passes quietly" 0 --quiet -- commit -m "feat: add a"
mark_check "commit-msg chains to the global hooks path" commit-msg
mark_check "pre-commit chains to the global hooks path" pre-commit
base="$(git rev-parse HEAD)"

check "human Co-Authored-By trailer passes" 0 --quiet -- \
  commit -m "docs: pair work" -m "Co-Authored-By: Ada Lovelace <ada@example.org>"
check "human named Aiden passes" 0 --quiet -- \
  commit -m "docs: pair work" -m "Co-Authored-By: Aiden Smith <aiden@example.org>"
check "Claude trailer refused" 1 --refused -- \
  commit -m "feat: x" -m "Co-Authored-By: Claude <${claude_addr}>"
check "Codex trailer refused" 1 --refused -- \
  commit -m "feat: x" -m "Co-authored-by: Codex <${codex_addr}>"
check "Copilot trailer refused" 1 --refused -- \
  commit -m "feat: x" -m "Co-Authored-By: Copilot <copilot@example.org>"
check "an AI trailer refused" 1 --refused -- \
  commit -m "feat: x" -m "Co-Authored-By: Some AI <bot@example.org>"
check "Gemini trailer refused" 1 --refused -- \
  commit -m "feat: x" -m "Co-Authored-By: Gemini <bot@example.org>"
check "GPT trailer refused" 1 --refused -- \
  commit -m "feat: x" -m "Co-Authored-By: ChatGPT <bot@example.org>"
check "Generated with line refused" 1 --refused -- \
  commit -m "feat: x" -m "Generated with some tool"
check "robot face refused" 1 --refused -- \
  commit -m "feat: x" -m "$robot made this"
check "[codex] subject prefix refused" 1 --refused -- \
  commit -m "[codex] feat: x"
check "non-conventional subject warns" 0 --warns -- commit -m "update stuff"
check "em dash in message warns" 0 --warns -- commit -m "fix: one ${em} two"

printf 'new %s dash\n' "$em" > dash.txt
git add dash.txt
check "em dash added to a new file warns" 0 --warns -- commit -m "docs: add dash file"
printf 'more %s dash\n' "$em" >> dash.txt
git add dash.txt
check "em dash added to a file that had one is quiet" 0 --quiet -- commit -m "docs: extend dash file"

# Record each local Huskycat dispatch without loading a developer's formatter.
mkdir "$work/bin"
cat > "$work/bin/huskycat" <<'HOOK'
#!/usr/bin/env bash
printf '%s %s %s\n' "$1" "$2" "${!#}" >> "$GFTB_TEST_DISPATCH"
HOOK
chmod +x "$work/bin/huskycat"
export PATH="$work/bin:$PATH" GFTB_TEST_DISPATCH="$work/dispatch"
printf 'hook pre-commit --complete-staged\nhook commit-msg --complete-staged\n' > "$work/expected"
: > "$work/dispatch"
check "the global hook owns Huskycat by default" 0 --quiet -- commit -m "test: global hooks"
check "the repository does not run a second formatter" 0 --quiet -- test ! -s "$work/dispatch"
git config gftb.huskycatOwner repo
check "a custom global hook can delegate formatting" 0 --quiet -- commit -m "test: custom hooks"
check "both Huskycat hooks run once" 0 --quiet -- cmp "$work/expected" "$work/dispatch"
git config --unset gftb.huskycatOwner
git config --global --unset core.hooksPath
: > "$work/dispatch"
check "a contributor without global hooks runs Huskycat" 0 --quiet -- commit -m "test: contributor hooks"
check "the standalone path runs both hooks once" 0 --quiet -- cmp "$work/expected" "$work/dispatch"
: > "$work/dispatch"

# Loop guard: a global hooks path equal to this directory is never chained to.
git config --global core.hooksPath "$hooks"
check "global hooks path equal to the repo hooks does not loop" 0 --quiet -- commit -m "chore: loop guard"
check "the shared hook path runs both hooks once" 0 --quiet -- cmp "$work/expected" "$work/dispatch"
git config --global core.hooksPath "$work/global-hooks"

# pre-push
mkdir -p "$work/github.com/Great-Falls-Tool-Bus" "$work/github.com/someone"
git init -q --bare "$work/github.com/Great-Falls-Tool-Bus/repo.git"
git init -q --bare "$work/github.com/someone/repo.git"
git remote add upstream "file://$work/github.com/Great-Falls-Tool-Bus/repo.git"
git remote add origin "file://$work/github.com/someone/repo.git"

git switch -q -c feat/ok "$base"
commit -m "feat: signed work"
check "push of signed work to the organization remote refused" 1 --refused -- git push -q upstream feat/ok
out_has "refusal names the Fork first section" 'Fork first'
check "push of signed work to the fork passes quietly" 0 --quiet -- git push -q origin feat/ok
if [ -s "$work/marks/pre-push" ] && grep -q 'refs/heads/feat/ok' "$work/marks/pre-push"; then
  passed=$((passed + 1)); echo "ok   pre-push chains to the global hooks path with stdin"
else
  failed=$((failed + 1)); echo "FAIL pre-push chain did not receive stdin"
fi

sha="$(git rev-parse HEAD)"
null="$(printf '%0*d' "${#sha}" 0)"
for url in git@github.com:Great-Falls-Tool-Bus/meta.git https://github.com/Great-Falls-Tool-Bus/meta.git \
  ssh://git@github.com/great-falls-tool-bus/meta.git; do
  check "synthetic push to $url refused" 1 --refused -- \
    bash -c "printf 'refs/heads/feat/ok %s refs/heads/feat/ok %s\n' '$sha' '$null' | '$hooks/pre-push' upstream '$url'"
done
check "synthetic push to a fork URL passes" 0 --quiet -- \
  bash -c "printf 'refs/heads/feat/ok %s refs/heads/feat/ok %s\n' '$sha' '$null' | '$hooks/pre-push' origin git@github.com:someone/meta.git"

git switch -q -c wip/x "$base"
commit -m "feat: signed work on a loose branch"
check "branch wip/x warns but pushes" 0 --warns -- git push -q origin wip/x

git switch -q -c feat/unsigned "$base"
commit --no-verify --no-gpg-sign -m "feat: unsigned work"
check "unsigned commit refused" 1 --refused -- git push -q origin feat/unsigned
out_has "unsigned refusal gives the rebase command" 'rebase --force-rebase --gpg-sign'

git switch -q -c feat/trailer "$base"
commit --no-verify -m "feat: trailer" -m "Co-Authored-By: Claude <${claude_addr}>"
check "AI trailer committed with --no-verify refused at push" 1 --refused -- git push -q origin feat/trailer

git switch -q -c feat/generated "$base"
commit --no-verify -m "feat: generated" -m "Generated with a tool"
check "generated-by line refused at push" 1 --refused -- git push -q origin feat/generated

# Commits already on a remote-tracking ref are not walked again.
git switch -q -c feat/legacy "$base"
commit --no-verify --no-gpg-sign -m "chore: legacy unsigned"
git push -q --no-verify origin feat/legacy
git switch -q -c feat/stacked
commit -m "feat: signed on top of legacy"
check "only commits not on a remote-tracking ref are walked" 0 --quiet -- git push -q origin feat/stacked

# Merge commits made by GitHub are exempt from the signature rule.
git switch -q -c feat/merged "$base"
commit -m "feat: left"
GIT_COMMITTER_NAME=GitHub GIT_COMMITTER_EMAIL="$github_merge_addr" \
  git merge -q --no-verify --no-ff --no-gpg-sign -m "Merge pull request #1 from someone/feat/ok" feat/ok
check "unsigned GitHub merge commit is exempt" 0 --quiet -- git push -q origin feat/merged

git switch -q -c feat/local-merge "$base"
commit -m "feat: right"
git merge -q --no-verify --no-ff --no-gpg-sign -m "Merge branch 'feat/ok'" feat/ok
check "unsigned local merge commit refused" 1 --refused -- git push -q origin feat/local-merge

check "branch deletion passes" 0 --quiet -- git push -q origin :wip/x

# tooling-paths.txt: path fixtures only, no network.
out_lacks() {
  if grep -qF -- "$2" "$out"; then
    failed=$((failed + 1))
    printf 'FAIL %s\n' "$1"
  else
    passed=$((passed + 1))
    printf 'ok   %s\n' "$1"
  fi
}

# shellcheck source=_lib.sh
. "$hooks/_lib.sh"
list="$hooks/tooling-paths.txt"

# path_status LIST REPO PATH prints the status column, or `clean`.
path_status() {
  local got
  got="$(printf '%s\n' "$3" | gftb_tooling_hits "$1" "$2" | cut -f3)"
  printf '%s\n' "${got:-clean}"
}

expect_path() {
  local want="$1" repo="$2" path="$3" got
  got="$(path_status "$list" "$repo" "$path")"
  if [ "$got" = "$want" ]; then
    passed=$((passed + 1))
    printf 'ok   %s %s:%s\n' "$want" "$repo" "$path"
  else
    failed=$((failed + 1))
    printf 'FAIL %s:%s is %s, wanted %s\n' "$repo" "$path" "$got" "$want"
  fi
}

while read -r repo path; do
  expect_path hit "$repo" "$path"
done <<'PATHS'
greatfallstoolbus.org AGENTS.md
greatfallstoolbus.org CLAUDE.md
greatfallstoolbus.org CLAUDE.local.md
greatfallstoolbus.org GEMINI.md
greatfallstoolbus.org docs/AGENTS.md
greatfallstoolbus.org packages/app/CLAUDE.md
greatfallstoolbus.org .claude/settings.json
greatfallstoolbus.org .claude/skills/release/SKILL.md
greatfallstoolbus.org .agents/skills/gftb-mail-laceup-gmail/SKILL.md
greatfallstoolbus.org .claude-plugin/marketplace.json
greatfallstoolbus.org .codex/config.toml
greatfallstoolbus.org .cursor/rules/house.mdc
greatfallstoolbus.org .cursorrules
greatfallstoolbus.org .gemini/settings.json
greatfallstoolbus.org .windsurf/rules/house.md
greatfallstoolbus.org .windsurfrules
greatfallstoolbus.org .aider.conf.yml
greatfallstoolbus.org .aiderignore
greatfallstoolbus.org .aider.tags.cache.v3/cache.db
greatfallstoolbus.org .mcp.json
greatfallstoolbus.org skills/release/SKILL.md
greatfallstoolbus.org scripts/build-agent-skills.mjs
greatfallstoolbus.org scripts/validate-skills.py
greatfallstoolbus.org docs/agent-notes/2026-11-01.md
greatfallstoolbus.org docs/agent-adoption.md
gftb-site static/agent-map.md
greatfallstoolbus.org .github/copilot-instructions.md
greatfallstoolbus.org .github/instructions/svelte.instructions.md
greatfallstoolbus.org .github/prompts/release.prompt.md
great-falls-tool-bus-infra docs/runbooks/platform-release-sitting-2026-11-n27.md
great-falls-tool-bus-infra docs/runbooks/platform-release-sitting-2026-10.md
great-falls-tool-bus-infra docs/runbooks/p0-sitting-2026-09.md
great-falls-tool-bus-infra tools/inventory-readiness/guard.py
great-falls-tool-bus-infra tools/inventory-readiness/guard_test.py
great-falls-tool-bus-infra docs/operating-rules.md
greatfallstoolbus.org ci/gate-box/Dockerfile
greatfallstoolbus.org ci/gate-box/examples/modal_gate.py
greatfallstoolbus.org scripts/gate-box.sh
greatfallstoolbus.org scripts/merge/squash-receipt.py
greatfallstoolbus.org scripts/house-graph-key.sh
greatfallstoolbus.org scripts/house-graph-key.test.mts
greatfallstoolbus.org AGENT.md
greatfallstoolbus.org agents.md
greatfallstoolbus.org Agents.md
greatfallstoolbus.org claude.md
greatfallstoolbus.org .Claude/settings.json
greatfallstoolbus.org a/b/c/skill.md
greatfallstoolbus.org .claude
greatfallstoolbus.org .agents
greatfallstoolbus.org packages/app/.claude
greatfallstoolbus.org .githooks/AGENTS.md
.github githooks/SKILL.md
greatfallstoolbus.org .huskycat/CLAUDE.md
greatfallstoolbus.org .github/workflows/.claude/settings.json
greatfallstoolbus.org .claudeignore
greatfallstoolbus.org .clinerules
greatfallstoolbus.org .clinerules/house.md
greatfallstoolbus.org .roo/rules/house.md
greatfallstoolbus.org .kiro/steering/house.md
greatfallstoolbus.org .continue/config.yaml
greatfallstoolbus.org .opencode/agent/house.md
greatfallstoolbus.org opencode.json
greatfallstoolbus.org .junie/guidelines.md
greatfallstoolbus.org .vscode/mcp.json
greatfallstoolbus.org .github/agents/release.agent.md
greatfallstoolbus.org apps/web/docs/agent-notes/x.md
greatfallstoolbus.org plugins/scaffold-core/.claude-plugin/plugin.json
greatfallstoolbus.org plugins/scaffold-core/skills/whoami/SKILL.md
PATHS

while read -r repo path; do
  expect_path clean "$repo" "$path"
done <<'PATHS'
greatfallstoolbus.org .githooks/pre-push
greatfallstoolbus.org .githooks/test.sh
.github githooks/_lib.sh
greatfallstoolbus.org .github/workflows/release.yml
greatfallstoolbus.org .github/workflows/agents.yml
greatfallstoolbus.org .github/lanes.json
greatfallstoolbus.org .github/PULL_REQUEST_TEMPLATE.md
greatfallstoolbus.org scripts/validate-lanes.py
greatfallstoolbus.org docs/schemas/lanes.schema.json
greatfallstoolbus.org src/routes/agents/+page.svelte
greatfallstoolbus.org src/routes/agents/+page.server.ts
greatfallstoolbus.org src/routes/mcp/+server.ts
greatfallstoolbus.org src/routes/.well-known/oauth-protected-resource/mcp/+server.ts
greatfallstoolbus.org src/routes/oauth/consent/+page.svelte
greatfallstoolbus.org src/routes/(member)/account/connected-agents/+page.svelte
greatfallstoolbus.org src/lib/server/agent/oauth.ts
greatfallstoolbus.org src/lib/server/agent/oauth.test.ts
greatfallstoolbus.org src/lib/agent/agents-page-copy.ts
greatfallstoolbus.org src/lib/server/db/agent-schema.ts
greatfallstoolbus.org e2e/agent-skeleton.spec.ts
greatfallstoolbus.org drizzle/0069_agent_grant.sql
greatfallstoolbus.org docs/runbooks/agent-kill-switch.md
greatfallstoolbus.org docs/runbooks/lab-release.md
greatfallstoolbus.org docs/operating-rules.md
greatfallstoolbus.org src/routes/(finance)/contributions/receipts/+page.svelte
greatfallstoolbus.org src/lib/server/contribution/receipt.ts
greatfallstoolbus.org scripts/check-tracked-tree.mjs
great-falls-tool-bus-infra tools/inventory-readiness/readiness.py
great-falls-tool-bus-infra tools/mail-owner-publication/guards_test.py
great-falls-tool-bus-infra scripts/remote-only-guard.sh
great-falls-tool-bus-infra docs/runbooks/platform-release.md
gftb-site src/content/goals/62-drafting-skillshare.md
gftb-site scripts/lib/log-source-guard.mjs
meta steering/operating-rules.md
meta packets/printed/2026-09-11/RECEIPT.md
greatfallstoolbus.org plugins/stripe/index.ts
greatfallstoolbus.org plugins/stripe/plugin.json
greatfallstoolbus.org skills/woodworking/intro.md
greatfallstoolbus.org src/lib/skills/index.ts
greatfallstoolbus.org docs/skills.md
greatfallstoolbus.org .huskycat/config.toml
greatfallstoolbus.org .vscode/settings.json
greatfallstoolbus.org src/routes/membership/agents/+page.svelte
greatfallstoolbus.org src/routes/oauth/authorize/+page.server.ts
greatfallstoolbus.org scripts/lanes.json
greatfallstoolbus.org scripts/landing-check.sh
greatfallstoolbus.org scripts/lanesync.sh
greatfallstoolbus.org docs/agent-notes.md
greatfallstoolbus.org .claude-code.txt
greatfallstoolbus.org static/llms.txt
greatfallstoolbus.org src/lib/data/mail-clients.ts
PATHS

# Product by operator ruling, TIN-3847 comment f95ca12f.
expect_path 'allowed TIN-3847' greatfallstoolbus.org static/agent-map.md

# Allow entries need a repository, an exact path, a ticket and a reason.
alt="$work/tooling-paths.txt"
cp "$list" "$alt"
printf 'allow greatfallstoolbus.org:scripts/house-graph-key.sh TIN-3847 fixture reason\n' >> "$alt"
check "an allow entry admits its exact path" 0 --quiet -- \
  test "$(path_status "$alt" greatfallstoolbus.org scripts/house-graph-key.sh)" = "allowed TIN-3847"
check "an allow entry admits no neighbour" 0 --quiet -- \
  test "$(path_status "$alt" greatfallstoolbus.org scripts/house-graph-key.test.mts)" = hit
check "an allow entry admits no other repository" 0 --quiet -- \
  test "$(path_status "$alt" gftb-site scripts/house-graph-key.sh)" = hit
for entry in 'allow greatfallstoolbus.org:scripts/x.sh' \
  'allow greatfallstoolbus.org:scripts/x.sh TIN-3847' \
  'allow scripts/x.sh TIN-3847 no repository' \
  'allow greatfallstoolbus.org:scripts/*.sh TIN-3847 a pattern' \
  'allow greatfallstoolbus.org:scripts/x.sh tin3847 bad ticket' \
  'allow greatfallstoolbus.org:scripts/../AGENTS.md TIN-3847 a parent segment' \
  'allow greatfallstoolbus.org:../AGENTS.md TIN-3847 a parent segment' \
  'permit AGENTS.md' \
  'keep .githooks/'; do
  cp "$list" "$alt"
  printf '%s\n' "$entry" >> "$alt"
  check "malformed entry rejected: $entry" 2 --any -- \
    bash -c ". '$hooks/_lib.sh'; printf 'AGENTS.md\n' | gftb_tooling_hits '$alt' meta"
done
check "a missing list is an error" 2 --any -- \
  bash -c ". '$hooks/_lib.sh'; printf 'AGENTS.md\n' | gftb_tooling_hits '$work/none.txt' meta"

# The pre-push hook warns about listed paths on organization pushes only.
git switch -q -c feat/tooling "$base"
mkdir -p ci/gate-box
printf 'notes\n' > AGENTS.md
printf 'FROM scratch\n' > ci/gate-box/Dockerfile
git add AGENTS.md ci/gate-box/Dockerfile
commit --no-verify -m "chore: add listed paths"
check "organization push with listed paths stays refused" 1 --refused -- git push -q upstream feat/tooling
out_has "the warning names AGENTS.md" 'adds or changes AGENTS.md'
out_has "the warning names the gate box path" 'adds or changes ci/gate-box/Dockerfile'
out_has "the warning names the Agents section" 'section "Agents"'
check "fork push with listed paths is not path checked" 0 --quiet -- git push -q origin feat/tooling
check "the fork's agents-overlay branch is not path checked" 0 --warns -- git push -q origin feat/tooling:agents-overlay
out_lacks "the overlay push has no path warning" 'tooling-paths.txt'
check "organization push after a fork push still warns" 1 --refused -- git push -q upstream feat/tooling
out_has "the warning survives a remote-tracking fork ref" 'adds or changes AGENTS.md'
git switch -q -c feat/unicode "$base"
mkdir -p "docs/$(printf '\303\251')"
printf 'notes\n' > "docs/$(printf '\303\251')/AGENTS.md"
git add docs
commit -m "docs: add a non-ASCII path"
check "organization push with a non-ASCII listed path stays refused" 1 --refused -- git push -q upstream feat/unicode
out_has "the warning names the non-ASCII path" "adds or changes docs/$(printf '\303\251')/AGENTS.md"

git switch -q feat/ok
check "organization push without listed paths has no path warning" 1 --refused -- git push -q upstream feat/ok
out_lacks "a clean organization push names no path" 'tooling-paths.txt'

git switch -q -c feat/rules "$base"
mkdir -p docs
printf 'rules\n' > docs/operating-rules.md
git add docs/operating-rules.md
commit -m "docs: add rules"
sha="$(git rev-parse HEAD)"
check "infra-only entry warns for infra" 1 --refused -- \
  bash -c "printf 'refs/heads/feat/rules %s refs/heads/feat/rules %s\n' '$sha' '$null' | '$hooks/pre-push' upstream https://github.com/Great-Falls-Tool-Bus/great-falls-tool-bus-infra.git"
out_has "infra-only entry names the path" 'adds or changes docs/operating-rules.md'
check "infra-only entry is quiet for the platform" 1 --refused -- \
  bash -c "printf 'refs/heads/feat/rules %s refs/heads/feat/rules %s\n' '$sha' '$null' | '$hooks/pre-push' upstream git@github.com:Great-Falls-Tool-Bus/greatfallstoolbus.org.git"
out_lacks "the platform push names no path" 'tooling-paths.txt'

printf '\nhooks-test: %s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
