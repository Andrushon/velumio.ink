#!/usr/bin/env bash
# check-clean-build.sh — prove the reading-companion builds from committed files only
# Usage: bash scripts/check-clean-build.sh
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SNAPSHOT_REF="${CLEAN_BUILD_REF:-HEAD}"
BARREL_PATH="lib/api-client-react/src/index.ts"
# The shared /tmp mount can enforce a per-job quota even when df reports ample
# free space. Keep the clean checkout on the workspace volume by default; it is
# still outside the committed snapshot and is removed by the EXIT trap.
CLEAN_BUILD_TMP_ROOT="${CLEAN_BUILD_TMPDIR:-$REPO_ROOT/.tmp}"
mkdir -p "$CLEAN_BUILD_TMP_ROOT"
TEMP_DIR="$(mktemp -d "$CLEAN_BUILD_TMP_ROOT/velumio-clean-build.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

cd "$REPO_ROOT"

if ! git rev-parse --verify "${SNAPSHOT_REF}^{commit}" >/dev/null 2>&1; then
  echo "ERROR: CLEAN_BUILD_REF '$SNAPSHOT_REF' is not a commit." >&2
  exit 1
fi

echo "▶ Checking generated API exports in committed snapshot $SNAPSHOT_REF..."

if ! git cat-file -e "${SNAPSHOT_REF}:${BARREL_PATH}" 2>/dev/null; then
  echo "ERROR: Committed snapshot is missing $BARREL_PATH" >&2
  exit 1
fi

MISSING_PATHS=()
while IFS= read -r export_path; do
  [ -n "$export_path" ] || continue
  generated_path="lib/api-client-react/src/${export_path#./}.ts"
  if ! git cat-file -e "${SNAPSHOT_REF}:${generated_path}" 2>/dev/null; then
    MISSING_PATHS+=("$generated_path")
  elif [ -z "$(git show "${SNAPSHOT_REF}:${generated_path}")" ]; then
    MISSING_PATHS+=("$generated_path (empty)")
  fi
done < <(
  git show "${SNAPSHOT_REF}:${BARREL_PATH}" |
    sed -nE 's/^[[:space:]]*export[[:space:]]+\*[[:space:]]+from[[:space:]]+"([^"]+)";?[[:space:]]*$/\1/p' |
    grep '^./generated/' || true
)

if [ "${#MISSING_PATHS[@]}" -gt 0 ]; then
  echo ""
  echo "ERROR: The committed snapshot cannot provide generated API exports."
  echo "Missing or empty paths:"
  printf '  - %s\n' "${MISSING_PATHS[@]}"
  echo ""
  echo "Run 'pnpm codegen', then commit every generated file before Publishing."
  exit 1
fi

echo "▶ Creating clean archive from committed snapshot..."
git archive "$SNAPSHOT_REF" | tar -x -C "$TEMP_DIR"

echo "▶ Installing snapshot dependencies from the local pnpm store..."
(
  cd "$TEMP_DIR"
  pnpm install --offline --frozen-lockfile --ignore-scripts
)

echo "▶ Building reading-companion from committed files..."
(
  cd "$TEMP_DIR"
  NODE_ENV=production PORT=8081 BASE_PATH=/ \
    pnpm --filter @workspace/reading-companion run build
)

echo "✓ Clean committed-snapshot build passed."