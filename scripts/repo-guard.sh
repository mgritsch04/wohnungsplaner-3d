#!/usr/bin/env bash
# Brandmauer: prüft Remote und Branch-Präfix. Aufruf: scripts/repo-guard.sh <owner/repo> <wp|fit>
set -euo pipefail
expected_repo="${1:?owner/repo}"; prefix="${2:?wp|fit}"
remote=$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
[ "$remote" = "$expected_repo" ] || { echo "ABBRUCH: Remote $remote != $expected_repo" >&2; exit 1; }
branch=$(git rev-parse --abbrev-ref HEAD)
case "$branch" in
  main) echo "ABBRUCH: nicht direkt auf main" >&2; exit 1;;
  claude/"$prefix"-*) ;;
  claude/*) echo "Hinweis: Altbranch $branch (Präfix claude/$prefix- empfohlen)";;
  *) echo "ABBRUCH: Branch $branch nicht unter claude/" >&2; exit 1;;
esac
