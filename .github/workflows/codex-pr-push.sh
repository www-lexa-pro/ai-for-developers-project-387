#!/usr/bin/env bash
set -euo pipefail

status() {
  printf 'status=%s\n' "$1" >> "$GITHUB_OUTPUT"
}

ref="refs/heads/$BRANCH"
[[ "$BRANCH" != main ]]
git check-ref-format "$ref"

if [[ "$1" == verify ]]; then
  pull=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR")
  if ! jq -e --arg repo "$GITHUB_REPOSITORY" --arg ref "$BRANCH" --arg sha "$BASE_SHA" \
    '.state == "open" and .head.repo.full_name == $repo and .head.ref == $ref and .head.sha == $sha' \
    <<< "$pull" >/dev/null; then
    status stale
    exit 0
  fi
  git fetch --no-tags origin "$ref"
  if [[ "$(git rev-parse FETCH_HEAD)" != "$BASE_SHA" ]]; then
    status stale
    exit 0
  fi
  git fetch "$RUNNER_TEMP/result.bundle" refs/heads/codex-checked-result
  [[ "$(git rev-parse FETCH_HEAD)" == "$CHECKED_SHA" ]]
  [[ "$(git show -s --format=%P "$CHECKED_SHA")" == "$BASE_SHA" ]]
  status ready
else
  [[ "$APP_SLUG" == hexlet-ai && -n "$BOT_ID" ]]
  [[ "$(gh api 'users/hexlet-ai%5Bbot%5D' --jq .id)" == "$BOT_ID" ]]
  gh auth setup-git
  # The parent check permits only a fast-forward. The lease makes the old SHA
  # an atomic precondition even when another commit arrives after verification.
  if git push --force-with-lease="$ref:$BASE_SHA" origin "$CHECKED_SHA:$ref"; then
    status published
  else
    current=$(git ls-remote origin "$ref")
    [[ "${current%%[[:space:]]*}" != "$BASE_SHA" ]]
    status stale
  fi
fi
