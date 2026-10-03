#!/usr/bin/env bash
set -euo pipefail
# Run INSIDE the authenticated Matrix computer, from this repository.
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Run this bootstrap inside your Matrix Linux computer." >&2
  exit 1
fi
command -v node >/dev/null
command -v npm >/dev/null
command -v gh >/dev/null
command -v codex >/dev/null
node -e 'if(Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
gh auth status --hostname github.com
codex login status
npm ci
npm run check
npm test
npm run build
echo "Foundation ready. Start Codex here and use docs/CODEX_START.md."
