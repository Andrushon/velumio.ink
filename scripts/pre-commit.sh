#!/usr/bin/env bash
# pre-commit.sh — run checks only when relevant files are staged
set -euo pipefail

# Guard against hand-editing orval-generated files. These files are produced
# by `pnpm codegen` and must never be edited directly — any manual change will
# be silently overwritten on the next codegen run.
#
# Strategy: if any generated file is staged, run the full codegen drift check.
# That re-generates the files and compares the result against what is staged.
# - Staged files that match codegen output → legitimate regeneration, allowed.
# - Staged files that differ from codegen output → hand-edit detected, blocked.
# - openapi.yaml staged without generated files → drift check still runs (existing logic below).
GENERATED_PATTERNS=(
  "lib/api-client-react/src/generated/"
  "lib/api-zod/src/generated/"
)
STAGED_GENERATED=""
for pat in "${GENERATED_PATTERNS[@]}"; do
  hits="$(git diff --cached --name-only | grep -F "$pat" || true)"
  STAGED_GENERATED+="$hits"$'\n'
done
STAGED_GENERATED="$(echo "$STAGED_GENERATED" | grep -v '^$' || true)"

OPENAPI_PATH="lib/api-spec/openapi.yaml"

if [ -n "$STAGED_GENERATED" ]; then
  echo "▶ Generated type files are staged — running codegen drift check to verify they match 'pnpm codegen'..."
  bash scripts/check-codegen.sh
elif git diff --cached --name-only | grep -qF "$OPENAPI_PATH"; then
  echo "▶ openapi.yaml is staged — running codegen drift check..."
  bash scripts/check-codegen.sh
else
  echo "▶ No generated files or openapi.yaml staged — skipping codegen drift check."
fi

# Verify every Express route in api-server is documented in the OpenAPI spec
# (and vice versa) whenever route files or the spec itself are staged. Catching
# spec drift here — at commit time — means it never reaches the repo, instead of
# being discovered post-merge by check-coverage in scripts/post-merge.sh.
ROUTES_PATTERN="^artifacts/api-server/src/routes/"
if git diff --cached --name-only | grep -qE "$ROUTES_PATTERN" \
  || git diff --cached --name-only | grep -qF "$OPENAPI_PATH"; then
  echo "▶ API routes or openapi.yaml staged — running spec-coverage check..."
  if ! pnpm --filter @workspace/api-spec run check-coverage; then
    echo ""
    echo "✖ Spec-coverage check failed."
    echo "  An Express route is missing from lib/api-spec/openapi.yaml, or the spec"
    echo "  declares a path with no matching route. Update openapi.yaml to match the"
    echo "  routes (then run 'pnpm codegen' and stage the result) and commit again."
    exit 1
  fi
  echo "✔ Spec coverage matches."
else
  echo "▶ No API route or openapi.yaml changes staged — skipping spec-coverage check."
fi

# Run the schema snapshot guard whenever DB schema files or the snapshot itself
# are staged. A mismatch means the schema changed without a corresponding
# migration — the commit is blocked until the snapshot is updated.
SCHEMA_PATTERN="^lib/db/"
if git diff --cached --name-only | grep -qE "$SCHEMA_PATTERN"; then
  echo "▶ DB schema files staged — running schema snapshot guard..."
  if ! pnpm --filter @workspace/api-server test:schema; then
    echo ""
    echo "✖ Schema snapshot check failed."
    echo "  If the schema change is intentional (migration already applied), update the snapshot:"
    echo "    UPDATE_SCHEMA_SNAPSHOT=true pnpm --filter @workspace/api-server test:schema"
    echo "  Then stage the updated lib/db/schema-snapshot.json and commit again."
    exit 1
  fi
  echo "✔ Schema snapshot matches."
else
  echo "▶ No DB schema files staged — skipping schema snapshot guard."
fi

# Run the type checker and linter whenever source files (under any src/) or
# relevant config files (tsconfig, eslint) are staged. Type errors and lint
# violations are caught here before they reach a PR — same philosophy as the
# test runner below, but for static analysis.
SRC_PATTERN='(^|/)src/.*\.(ts|tsx|js|jsx)$'
CONFIG_PATTERN='(tsconfig[^/]*\.json|eslint\.config\.[^/]+|\.eslintrc[^/]*)$'
STAGED_SRC="$(git diff --cached --name-only --diff-filter=ACMR | grep -E "$SRC_PATTERN|$CONFIG_PATTERN" || true)"

if [ -n "$STAGED_SRC" ]; then
  echo "▶ Source or config files staged — running type checker..."
  if ! pnpm typecheck; then
    echo ""
    echo "✖ Type check failed. Fix the type errors above and commit again."
    exit 1
  fi
  echo "✔ Type check passed."

  echo "▶ Source or config files staged — running linter..."
  if ! pnpm lint; then
    echo ""
    echo "✖ Lint check failed. Fix the lint errors above and commit again."
    exit 1
  fi
  echo "✔ Lint check passed."
else
  echo "▶ No source or config files staged — skipping typecheck and lint."
fi

# Run only the tests related to staged source/test files for fast, targeted
# feedback. Vitest's `related` command walks the module graph and runs just the
# test files that (transitively) import the changed files — so editing a source
# file still exercises its tests even when the test file itself is untouched,
# and editing a shared lib still triggers the tests of every package that
# imports it. The full suite still runs in CI via `pnpm test`.
CODE_PATTERN='\.(ts|tsx|js|jsx)$'
STAGED_FILES="$(git diff --cached --name-only --diff-filter=ACMR | grep -E "$CODE_PATTERN" || true)"

if [ -z "$STAGED_FILES" ]; then
  echo "▶ No JS/TS files staged — skipping test run."
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
# Use absolute paths so each package's Vitest can resolve files that live
# outside its own root (e.g. shared libs under lib/ that the package imports).
ABS_FILES=()
while IFS= read -r f; do
  [ -n "$f" ] && ABS_FILES+=("$REPO_ROOT/$f")
done <<< "$STAGED_FILES"

# Hand the full staged set to every workspace package that has a Vitest config.
# `related` only runs the tests in that package that actually depend on one of
# the staged files; packages with no related tests exit cleanly via
# --passWithNoTests, so unrelated changes add only Vitest's quick startup cost.
for config in artifacts/*/vitest.config.* lib/*/vitest.config.* lib/integrations/*/vitest.config.*; do
  [ -e "$config" ] || continue
  pkg_dir="$(dirname "$config")"
  echo "▶ Running tests related to staged files in $pkg_dir ..."
  ( cd "$pkg_dir" && pnpm exec vitest related --run --passWithNoTests "${ABS_FILES[@]}" )
done
