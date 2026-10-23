#!/usr/bin/env bash
# Start every dev service needed for local development in parallel:
#   - API server          (artifacts/api-server)
#   - AI Reading Companion (artifacts/reading-companion)
#   - OpenAPI codegen watch (lib/api-spec)
#
# Press Ctrl-C (or stop the workflow) to shut them all down together.
#
# PORT / BASE_PATH are read from each artifact's .replit-artifact/artifact.toml
# (the single source of truth the preview proxy uses) so that changing an
# artifact's port or base path never requires editing this launcher.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_TOML="$ROOT_DIR/artifacts/api-server/.replit-artifact/artifact.toml"
RC_TOML="$ROOT_DIR/artifacts/reading-companion/.replit-artifact/artifact.toml"

# Read the first `key = value` assignment for KEY from a TOML file, stripping
# surrounding quotes, inline comments and trailing whitespace. Good enough for
# the simple scalar keys we need (localPort, BASE_PATH); not a full TOML parser.
toml_value() {
  local file="$1" key="$2"
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*"key"[[:space:]]*=" {
      sub(/^[^=]*=[[:space:]]*/, "")
      sub(/[[:space:]]*#.*$/, "")
      gsub(/["'\'']/, "")
      gsub(/[[:space:]]+$/, "")
      print
      exit
    }
  ' "$file"
}

require_value() {
  local name="$1" value="$2" file="$3"
  if [[ -z "$value" ]]; then
    echo "[dev-all] error: could not read $name from $file" >&2
    exit 1
  fi
}

API_PORT="$(toml_value "$API_TOML" localPort)"
require_value "localPort" "$API_PORT" "$API_TOML"

RC_PORT="$(toml_value "$RC_TOML" localPort)"
require_value "localPort" "$RC_PORT" "$RC_TOML"

RC_BASE_PATH="$(toml_value "$RC_TOML" BASE_PATH)"
require_value "BASE_PATH" "$RC_BASE_PATH" "$RC_TOML"

pids=()

cleanup() {
  trap - INT TERM EXIT
  echo "[dev-all] shutting down dev services..."
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "[dev-all] starting API server (PORT=$API_PORT), reading companion (PORT=$RC_PORT BASE_PATH=$RC_BASE_PATH), and codegen watch..."

PORT="$API_PORT" pnpm --filter @workspace/api-server run dev &
pids+=("$!")

PORT="$RC_PORT" BASE_PATH="$RC_BASE_PATH" pnpm --filter @workspace/reading-companion run dev &
pids+=("$!")

pnpm --filter @workspace/api-spec run codegen:watch &
pids+=("$!")

# Wait for the first service to exit, then tear the rest down so the workflow
# does not appear "running" while a service has actually crashed.
wait -n
cleanup
