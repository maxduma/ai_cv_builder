#!/usr/bin/env bash
# UserPromptSubmit hook: soft, proactive hint. If the current branch's PR is
# already MERGED, inject a note so Claude opens a fresh branch before committing.
# stdout (exit 0) is added to Claude's context. Emits nothing in the normal case.
# Cached ~2 min so it doesn't add GitHub-API latency to every prompt.

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
command -v gh >/dev/null 2>&1 || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ -n "$branch" ] && [ "$branch" != "HEAD" ] && [ "$branch" != "main" ] && [ "$branch" != "master" ] || exit 0

repo=$(git rev-parse --show-toplevel 2>/dev/null)
cache_dir="${TMPDIR:-/tmp}/claude-branch-status"
mkdir -p "$cache_dir" 2>/dev/null
key=$(printf '%s|%s' "$repo" "$branch" | shasum 2>/dev/null | cut -d' ' -f1)
cache_file="$cache_dir/$key"

# Use cached answer if younger than 2 minutes.
if [ -n "$key" ] && [ -f "$cache_file" ] && [ -z "$(find "$cache_file" -mmin +2 2>/dev/null)" ]; then
  cat "$cache_file"
  exit 0
fi

num=$(gh pr list --head "$branch" --state merged --json number --limit 1 2>/dev/null | jq -r '.[0].number // empty')

msg=""
if [ -n "$num" ]; then
  msg="NOTE: the current git branch '$branch' already has a MERGED pull request (#$num). Before making any new commits, switch to an updated trunk and create a fresh branch: git checkout main && git pull && git checkout -b <new-branch>. Do not add commits to this merged branch."
fi

# Cache the result (even when empty) to avoid re-querying every prompt.
[ -n "$key" ] && printf '%s' "$msg" > "$cache_file" 2>/dev/null

[ -n "$msg" ] && printf '%s\n' "$msg"
exit 0
