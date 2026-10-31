#!/usr/bin/env bash
#
# deploy.sh — canonical push + deploy script for TradeBot.
#
# Step 1 (push): stage/commit/push everything to GitHub. This folds in what
#   used to be git.sh (a placeholder) / gitpush.sh (the real logic).
#
# Step 2 (deploy): TradeBot has NO hosting/deploy platform configured — no
#   .github/workflows CI/CD, no netlify.toml/vercel.json/firebase.json/
#   Dockerfile/.firebaserc. It's a locally-run Node trading bot (dashboard +
#   trading loop), not a hosted web app. So there is no auto-deploy to defer
#   to and no real platform deploy command to run. This step says that
#   plainly and reminds you how to actually run the bot, instead of
#   perpetuating the old deploy.sh's "npm install && npm run build" (which
#   fails today — package.json has no "build" script).
#
# Usage: ./deploy.sh ["commit message"] [--force-manual] [-h|--help]
#
set -euo pipefail
# Select the GitHub account for this repository before every push.
# Override GITHUB_ACCOUNT when a repository is intentionally owned by a different account.
GITHUB_ACCOUNT="${GITHUB_ACCOUNT:-didigamnithin}"

ensure_github_account() {
  command -v gh >/dev/null 2>&1 || {
    echo "GitHub CLI (gh) is required to push as $GITHUB_ACCOUNT." >&2
    echo "Install gh and authenticate with: gh auth login --hostname github.com" >&2
    return 1
  }
  gh auth token --hostname github.com --user "$GITHUB_ACCOUNT" >/dev/null 2>&1 || {
    echo "GitHub CLI is not authenticated as $GITHUB_ACCOUNT." >&2
    echo "Authenticate that account first, then rerun this deploy." >&2
    return 1
  }
  # Push as $GITHUB_ACCOUNT through git-credential-ghuser (see ~/.gitconfig-<company>)
  # instead of switching gh's active account for every other terminal and repo.
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.https://github.com.username GIT_CONFIG_VALUE_0="$GITHUB_ACCOUNT"
  echo "Using GitHub account: $GITHUB_ACCOUNT"
}

push_with_github_account() {
  ensure_github_account
  git push "$@"
}


ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
# Deploys ship main: commit pending work, merge every local and GitHub branch
# into main, and push main before the deploy below runs. Anything unsafe (a
# merge conflict, a secret, dependency folder or >100 MB file about to be
# committed, a failed push) stops the deploy before it ships.
# Flags that skip git skip this too.
_sync_git() {
  if [ -n "${_SYNC_TOKEN:-}" ]; then
    GH_TOKEN="$_SYNC_TOKEN" git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"
  else
    git "$@"
  fi
}

# Unstages everything and fails if `git add -A` picked up a new file that must not be committed.
_sync_check_staged() {
  local raw big line meta path mode sha bad=""
  raw="$(git -c core.quotePath=false diff --cached --diff-filter=A --no-renames --raw --no-abbrev)"
  [ -n "$raw" ] || return 0
  big=" $(printf '%s\n' "$raw" | awk '$2 != "160000" {print $4}' \
    | git cat-file --batch-check='%(objectsize) %(objectname)' | awk '$1 > 100000000 {print $2}' | tr '\n' ' ')"
  while IFS= read -r line; do
    meta="${line%%	*}"; path="${line#*	}"
    read -r _ mode _ sha _ <<< "$meta"
    case "/$path" in
      */.env.example|*/.env.sample|*/.env.template|*.example) ;;
      */.env|*/.env.*|*.pem|*.key|*.p12|*.pfx|*.jks|*.keystore|*/id_rsa*|*/id_ed25519*|*service-account*.json|*serviceAccount*.json|*/credentials.json|*client_secret*.json)
        bad="$bad"$'\n'"  $path  (looks like a secret)" ;;
      */node_modules/*) bad="$bad"$'\n'"  $path  (dependency folder)" ;;
    esac
    case "$big" in *" $sha "*) bad="$bad"$'\n'"  $path  (over 100 MB; GitHub rejects it)" ;; esac
    if [ "$mode" = 160000 ] && ! git config -f .gitmodules --get-regexp '\.path$' 2>/dev/null | awk '{print $2}' | grep -qxF "$path"; then
      bad="$bad"$'\n'"  $path  (nested git repo; its files would not ship)"
    fi
  done <<< "$raw"
  [ -n "$bad" ] || return 0
  git reset -q
  echo "Deploy stopped: nothing was committed, because these new files should not go into git:$bad" >&2
  echo "Add them to .gitignore (or commit them yourself if they really belong in git), then rerun." >&2
  return 1
}

# Each app keeps its videos and marketing files in content/, which never goes into git.
_sync_ignore_content() {
  grep -qxF '/content/' .gitignore 2>/dev/null \
    || printf '\n# Videos and marketing content live here; never committed.\n/content/\n' >> .gitignore
  [ -z "$(git ls-files content)" ] || git rm -r -q --cached content
}

_sync_merge() {
  case "$1" in refs/heads/main|refs/remotes/origin/HEAD|*/gh-pages) return 0 ;; esac
  git merge-base --is-ancestor "$1" HEAD 2>/dev/null && return 0
  echo "Merging ${1#refs/}"
  git merge -q --no-edit "$1" && return 0
  git merge --abort 2>/dev/null || true
  echo "Deploy stopped: ${1#refs/} does not merge cleanly into main. Merge it by hand, then rerun." >&2
  return 1
}

sync_branches_into_main() {
  local arg ref start start_ref before tries _SYNC_TOKEN=""
  for arg in "$@"; do
    case "$arg" in -h|--help|--dry-run|--no-git|--no-push|--skip-push|--deploy-only) return 0 ;; esac
  done
  [ -z "${DEPLOY_BRANCHES_SYNCED:-}" ] || return 0
  if [ -f .git ] || [ "$(git rev-parse --show-toplevel 2>/dev/null)" != "$(pwd -P)" ]; then
    echo "Branch sync skipped: $(pwd) is not a standalone git repository."
    return 0
  fi
  git remote get-url origin >/dev/null 2>&1 || { echo "Branch sync skipped: no 'origin' remote."; return 0; }
  for ref in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do
    [ ! -e "$(git rev-parse --git-path "$ref")" ] || { echo "Deploy stopped: finish the in-progress git operation first." >&2; return 1; }
  done
  ref="$(git rev-parse --git-path index.lock)"
  [ ! -e "$ref" ] || { echo "Deploy stopped: another git command is running (or delete the stale $ref)." >&2; return 1; }
  case "$(git remote get-url origin)" in
    https://github.com/*)
      if [ -n "${GITHUB_ACCOUNT:-}" ] && command -v gh >/dev/null 2>&1; then
        _SYNC_TOKEN="$(gh auth token --hostname github.com --user "$GITHUB_ACCOUNT" 2>/dev/null)" \
          || { echo "Deploy stopped: GitHub CLI is not logged in as $GITHUB_ACCOUNT (gh auth login)." >&2; return 1; }
      fi ;;
  esac
  before="$(cksum < deploy.sh)"
  start="$(git symbolic-ref -q --short HEAD || git rev-parse --short HEAD)"

  echo "==> 1/3 Commit pending changes on $start"
  _sync_ignore_content || return 1
  git add -A || return 1
  _sync_check_staged || return 1
  git diff --cached --quiet || git commit -q -m "chore: commit pending changes before deploy" || return 1
  start_ref="$(git symbolic-ref -q HEAD || git rev-parse HEAD)"

  echo "==> 2/3 Merge local and GitHub branches into main"
  _sync_git fetch -q --prune origin || { echo "Deploy stopped: could not fetch from origin." >&2; return 1; }
  if git show-ref --verify --quiet refs/heads/main || git show-ref --verify --quiet refs/remotes/origin/main; then
    git checkout -q main || { echo "Deploy stopped: could not switch to main (git's reason is above)." >&2; return 1; }
  else
    git checkout -q -b main || return 1
  fi
  for ref in "$start_ref" $(git for-each-ref --format='%(refname)' refs/heads refs/remotes/origin); do
    _sync_merge "$ref" || { echo "You were on $start; you are now on main." >&2; return 1; }
  done

  echo "==> 3/3 Push main"
  for tries in 1 2; do
    _sync_git push -q -u origin main && break
    [ "$tries" = 1 ] || { echo "Deploy stopped: pushing main to origin failed." >&2; return 1; }
    echo "Push rejected; merging the latest origin/main and retrying."
    _sync_git fetch -q origin || return 1
    _sync_merge refs/remotes/origin/main || return 1
  done
  [ "$(_sync_git ls-remote origin refs/heads/main | cut -f1)" = "$(git rev-parse HEAD)" ] \
    || { echo "Deploy stopped: origin main does not match local main after the push." >&2; return 1; }

  export DEPLOY_BRANCHES_SYNCED=1
  if [ "$(cksum < deploy.sh)" != "$before" ]; then
    echo "deploy.sh changed in the merge; restarting with the merged version."
    exec bash ./deploy.sh "$@"
  fi
}
# A fresh checkout has no node_modules; install the locked dependencies before building.
_ensure_node_deps() {
  [ -f package.json ] && [ ! -d node_modules ] || return 0
  echo "==> Installing npm dependencies (node_modules is missing)"
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi \
    || { echo "Deploy stopped: npm could not install dependencies." >&2; return 1; }
}
sync_branches_into_main "$@" || exit 1
_ensure_node_deps || exit 1


REMOTE_NAME="origin"
REMOTE_URL="https://github.com/nhancio/tradebot.git"
DEFAULT_BRANCH="main"

usage() {
  cat <<EOF
Usage: ./deploy.sh [commit message] [--force-manual]

Step 1 (push to GitHub):
  - Ensures the "$REMOTE_NAME" remote exists and points at
    $REMOTE_URL (adds or fixes it if not).
  - git add -A, commits (using the given message, or a timestamped default
    if none given / nothing changed to warrant one), then pushes the
    current branch.

Step 2 (deploy):
  TradeBot has no hosting/CI-CD platform wired up (checked for
  .github/workflows, netlify.toml, vercel.json, firebase.json, Dockerfile,
  .firebaserc — none exist). It runs locally, so this step just prints
  that and tells you how to start it:
    npm run ui         # dashboard, http://localhost:3000
    npm run bot        # trading loop (paper trading by default)
    npm run bot:live   # trading loop, live orders

  --force-manual   Run the OLD deploy.sh's command anyway:
                    "npm install && npm run build". This is kept only for
                    reference/back-compat — package.json currently has no
                    "build" script, so it will fail with
                    "Missing script: build" unless one is added.
  -h, --help       Show this help.
EOF
}

FORCE_MANUAL=0
COMMIT_MSG=""
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --force-manual)
      FORCE_MANUAL=1
      ;;
    *)
      COMMIT_MSG="$arg"
      ;;
  esac
done

echo "=================================================="
echo "Step 1: push to GitHub"
echo "=================================================="

if [ ! -d .git ]; then
  echo "No git repo here yet — initializing one and setting branch to '$DEFAULT_BRANCH'."
  git init
  git checkout -b "$DEFAULT_BRANCH" 2>/dev/null || git branch -m "$DEFAULT_BRANCH" 2>/dev/null || true
fi

if ! git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  echo "No '$REMOTE_NAME' remote configured — adding it: $REMOTE_URL"
  git remote add "$REMOTE_NAME" "$REMOTE_URL"
else
  CURRENT_URL="$(git remote get-url "$REMOTE_NAME")"
  if [ "$CURRENT_URL" != "$REMOTE_URL" ]; then
    echo "'$REMOTE_NAME' remote points elsewhere ($CURRENT_URL) — fixing it to $REMOTE_URL"
    git remote set-url "$REMOTE_NAME" "$REMOTE_URL"
  fi
fi

# Nested git repos (e.g. an accidentally-cloned subfolder) should never be
# swallowed as plain directory contents. Git itself records them as gitlinks
# rather than descending into them, but flag it clearly rather than staying
# silent about it.
NESTED_REPOS="$(find . -mindepth 2 -not -path "./node_modules/*" -not -path "./.git/*" -name ".git" 2>/dev/null || true)"
if [ -n "$NESTED_REPOS" ]; then
  echo "Note: nested git repo(s) detected under subfolders — they'll be tracked as gitlinks, not plain files:"
  echo "$NESTED_REPOS"
fi

git add -A

if git rev-parse --verify HEAD >/dev/null 2>&1 && git diff --cached --quiet; then
  echo "Nothing staged to commit — skipping commit."
else
  if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="chore: deploy $(date '+%Y-%m-%d %H:%M:%S')"
  fi
  git commit -m "$COMMIT_MSG"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
  BRANCH="$DEFAULT_BRANCH"
fi

echo "Pushing '$BRANCH' to '$REMOTE_NAME'..."
push_with_github_account -u "$REMOTE_NAME" "$BRANCH"

echo ""
echo "=================================================="
echo "Step 2: platform deploy"
echo "=================================================="

if [ "$FORCE_MANUAL" = 1 ]; then
  echo "--force-manual given: running the old deploy.sh command (npm install && npm run build)."
  echo "Note: this is expected to fail — package.json has no 'build' script."
  npm install && npm run build
else
  cat <<'EOF'
No hosting/deploy platform is configured for TradeBot: no .github/workflows
CI/CD, no netlify.toml / vercel.json / firebase.json / Dockerfile /
.firebaserc anywhere in the repo. This is a locally-run trading bot, not a
hosted web app — pushing to GitHub (step 1, done above) is the whole
"deploy" for this project. There is nothing further to run, and no real
deploy command exists to invent one for.

To actually run TradeBot locally:
  npm run ui         # dashboard  -> http://localhost:3000
  npm run bot         # trading loop (paper trading by default)
  npm run bot:live    # trading loop, live orders

If real hosting is added later (e.g. PM2 on a server, per PLAN.md Phase 5),
wire that real command in here — don't reach for --force-manual.
EOF
fi
