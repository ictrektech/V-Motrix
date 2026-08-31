#!/usr/bin/env bash
set -euo pipefail

TAG_PREFIX="vos-v-motrix-v"
VERSION_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/VERSION"
REPO_ROOT="$(git -C "$(dirname "$VERSION_FILE")" rev-parse --show-toplevel)"

usage() { printf 'Usage: %s [patch|minor|major]\n' "$0"; }
part="${1:-patch}"
[[ "$part" != "-h" && "$part" != "--help" ]] || { usage; exit 0; }

cd "$REPO_ROOT"
git diff --quiet && git diff --cached --quiet || {
  printf 'worktree is not clean; commit code changes before releasing\n' >&2
  exit 1
}

current="$(tr -d '[:space:]' < "$VERSION_FILE")"
[[ "$current" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'invalid VERSION: %s\n' "$current" >&2; exit 1; }
IFS=. read -r major minor patch <<< "$current"
case "$part" in
  patch) patch=$((patch + 1)) ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  major) major=$((major + 1)); minor=0; patch=0 ;;
  *) usage >&2; exit 2 ;;
esac
version="${major}.${minor}.${patch}"
trigger_tag="${TAG_PREFIX}${version}"
public_tag="v${version}"
for tag in "$trigger_tag" "$public_tag"; do
  if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null || \
     git ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null 2>&1; then
    printf 'tag already exists: %s\n' "$tag" >&2
    exit 1
  fi
done

printf '%s\n' "$version" > "$VERSION_FILE"
git add "$VERSION_FILE"
git commit -m "chore: release VOS v-motrix ${version}"
git tag "$trigger_tag"
branch="$(git branch --show-current)"
git push origin "$branch"
git push origin "$trigger_tag"
printf 'Pushed %s; CI will create release %s.\n' "$trigger_tag" "$public_tag"
