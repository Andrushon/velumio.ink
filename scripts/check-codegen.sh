#!/usr/bin/env bash
# check-codegen.sh — fail if generated files are out of sync with openapi.yaml
# Usage: bash scripts/check-codegen.sh
set -euo pipefail

echo "▶ Running pnpm codegen..."
pnpm codegen

GENERATED_DIRS=(
  "lib/api-client-react/src/generated"
  "lib/api-zod/src/generated"
)

echo "▶ Checking for changes in generated files..."
# Compare working tree against the index (not HEAD) so the check is correct
# both in pre-commit hooks (where staged codegen output is expected and lives
# in the index) and in CI (where index == HEAD, so any codegen change is caught).
#
# git diff --name-only  → tracked files that differ between working tree and index
# git ls-files --others → new untracked files produced by codegen
DRIFT_MODIFIED=$(git diff --name-only -- "${GENERATED_DIRS[@]}")
DRIFT_UNTRACKED=$(git ls-files --others --exclude-standard -- "${GENERATED_DIRS[@]}")
DRIFT=$(printf '%s\n%s' "$DRIFT_MODIFIED" "$DRIFT_UNTRACKED" | grep -v '^$' || true)

if [ -n "$DRIFT" ]; then
  echo ""
  echo "╔═══════════════════════════════════════════════════════════╗"
  echo "║  ERROR: Generated files are out of sync with openapi.yaml ║"
  echo "╚═══════════════════════════════════════════════════════════╝"
  echo ""
  echo "The following files differ from what is staged/committed:"
  echo "$DRIFT"
  echo ""
  echo "Run pnpm codegen, stage the result, and retry your commit."

  # Write drift list to a file so CI can include it in failure notifications
  if [ -n "${RUNNER_TEMP:-}" ]; then
    echo "$DRIFT" > "$RUNNER_TEMP/codegen-drift.txt"
  fi

  exit 1
fi

echo "✓ Codegen check passed — all generated files are up to date."
