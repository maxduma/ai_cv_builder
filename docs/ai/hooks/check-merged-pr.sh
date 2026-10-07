#!/usr/bin/env bash
# PreToolUse(Bash) hook: hard-block `git commit` when the current branch's PR is
# already MERGED, so new work doesn't pile orphaned commits onto a stale branch.
# exit 2 = block the tool call and feed stderr back to Claude. Fails open.

payload=$(cat)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')

# Only act on a real `git commit` invocation at a command boundary (start of
# line or after a shell separator) — NOT "git commit" appearing as data/echo,
# and not `git log | grep commit` / `git commit-tree`.
printf '%s' "$command" | grep -qE '(^|[;&|(){}])[[:space:]]*git[[:space:]]+commit([[:space:]]|[;&|)}]|$)' || exit 0

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ -n "$branch" ] && [ "$branch" != "HEAD" ] || exit 0

# Needs gh; if absent or offline, fail open (don't block real work).
command -v gh >/dev/null 2>&1 || exit 0
merged=$(gh pr list --head "$branch" --state merged --json number --limit 1 2>/dev/null) || exit 0

if [ "$(printf '%s' "$merged" | jq 'length' 2>/dev/null)" -gt 0 ] 2>/dev/null; then
  num=$(printf '%s' "$merged" | jq -r '.[0].number')
  {
    echo "BLOCKED: branch '$branch' already has a MERGED pull request (#$num)."
    echo "Do NOT add commits here — they would be orphaned on a closed PR."
    echo "Start fresh, then redo the commit:"
    echo "  git checkout main && git pull && git checkout -b <new-branch>"
  } >&2
  exit 2
fi

exit 0
