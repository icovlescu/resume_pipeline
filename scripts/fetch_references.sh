#!/usr/bin/env bash
# Shallow-clone the reference repos listed in references/repos.tsv into
# references/vendor/ at their pinned commits. The clones are read-only study
# material and are gitignored; nothing from them is committed here.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
vendor="$root/references/vendor"
mkdir -p "$vendor"

grep -v '^#' "$root/references/repos.tsv" | while IFS=$'\t' read -r name url sha _license _role; do
  [ -z "$name" ] && continue
  dest="$vendor/$name"
  if [ ! -d "$dest/.git" ]; then
    git init -q "$dest"
    git -C "$dest" remote add origin "$url"
  fi
  git -C "$dest" fetch -q --depth 1 origin "$sha"
  git -C "$dest" checkout -q --detach FETCH_HEAD
  echo "$name @ ${sha:0:7}"
done
