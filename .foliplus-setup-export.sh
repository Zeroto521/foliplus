#!/usr/bin/env bash
set -uo pipefail
cd "C:/Users/Zero/Documents/GitHub/foliplus"
git fetch origin --quiet 2>&1 | tail -2
WT=".agents/worktrees/wt-export-phase-state"
if git worktree list --porcelain | grep -q "branch refs/heads/feat/export-phase-state"; then
  echo "BRANCH_ALREADY_EXISTS"
else
  git worktree add -b feat/export-phase-state "$WT" origin/main 2>&1 | tail -3
fi
if [ -e "$WT/node_modules" ]; then
  echo "junction already present"
else
  if [ -d "$WT/node_modules" ] && [ ! -L "$WT/node_modules" ]; then cmd /c rmdir "$WT\\node_modules"; fi
  cmd /c mklink /J "$WT\\node_modules" "C:\Users\Zero\Documents\GitHub\foliplus\node_modules" 2>&1 | tail -1
fi
cd "$WT" && echo "--- HEAD ---" && git log --format='%h %s' -1
echo "--- ExportControl js ---" && ls foliplus/js/control/ExportControl
echo "--- tests ---" && ls test/js/control/ExportControl
