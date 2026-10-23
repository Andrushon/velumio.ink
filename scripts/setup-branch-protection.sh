#!/usr/bin/env bash
# setup-branch-protection.sh — make the spec-coverage CI check a *required*
# status check on protected branches, so a PR cannot be merged while it is red.
#
# Why this exists:
#   The `spec-coverage-check` GitHub Actions job (.github/workflows/
#   spec-coverage-check.yml) flags API spec drift on every push/PR, but a red
#   check only *blocks* a merge if the branch's protection rule requires it.
#   This script wires that requirement up via the GitHub REST API so the
#   configuration is reproducible and version-controlled instead of being a
#   one-off click in the GitHub UI.
#
# What it does (idempotent, surgical):
#   - Resolves the exact required-status-check *context* from the workflow file
#     (GitHub identifies an Actions check by the job's `name:`, not its id).
#   - For each branch, if protection already exists it MERGES the context into
#     the existing required-status-checks list (preserving every other check and
#     every other protection setting). If no protection exists yet it creates a
#     minimal rule that only requires this check.
#   - Re-running changes nothing once the context is present.
#
# Requirements:
#   - GitHub CLI (`gh`) authenticated as a repo admin, or a token with `repo`
#     scope exported as `GH_TOKEN` / `GITHUB_TOKEN`.
#   - `jq` on PATH.
#
# Usage:
#   bash scripts/setup-branch-protection.sh                 # protect `main`
#   bash scripts/setup-branch-protection.sh main release    # protect several branches
#   REPO=owner/name bash scripts/setup-branch-protection.sh # override repo detection
#   CHECK_CONTEXT="Custom name" bash scripts/setup-branch-protection.sh
set -euo pipefail

WORKFLOW_FILE=".github/workflows/spec-coverage-check.yml"
JOB_ID="spec-coverage-check"

command -v gh >/dev/null 2>&1 || { echo "✖ GitHub CLI (gh) is not installed." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "✖ jq is not installed." >&2; exit 1; }

# Resolve the repository (owner/name).
REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)}"
if [ -z "${REPO}" ]; then
  echo "✖ Could not determine the repository. Set REPO=owner/name and retry." >&2
  exit 1
fi

# Resolve the required-status-check context. GitHub identifies a GitHub Actions
# check run by the job's display name (its `name:` field), so that string — not
# the job id — is what branch protection must require. Derive it from the
# workflow file so the two never drift apart.
if [ -z "${CHECK_CONTEXT:-}" ]; then
  if [ ! -f "${WORKFLOW_FILE}" ]; then
    echo "✖ Workflow file not found: ${WORKFLOW_FILE}" >&2
    exit 1
  fi
  CHECK_CONTEXT="$(
    awk -v job="  ${JOB_ID}:" '
      $0 == job { injob = 1; next }
      injob && /^[[:space:]]+name:[[:space:]]*/ {
        sub(/^[[:space:]]+name:[[:space:]]*/, "")
        gsub(/^["'\''"]|["'\''"]$/, "")
        print
        exit
      }
      injob && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { exit }  # next job, no name found
    ' "${WORKFLOW_FILE}"
  )"
  if [ -z "${CHECK_CONTEXT}" ]; then
    echo "✖ Could not read the job name for '${JOB_ID}' from ${WORKFLOW_FILE}." >&2
    echo "  Set CHECK_CONTEXT to the check name shown in the Actions UI and retry." >&2
    exit 1
  fi
fi

BRANCHES=("$@")
if [ ${#BRANCHES[@]} -eq 0 ]; then
  BRANCHES=("main")
fi

echo "Repository:        ${REPO}"
echo "Required check:     ${CHECK_CONTEXT}"
echo "Protected branches: ${BRANCHES[*]}"
echo

for BRANCH in "${BRANCHES[@]}"; do
  echo "▶ ${BRANCH}"

  # Does a protection rule already exist on this branch?
  if existing="$(gh api "repos/${REPO}/branches/${BRANCH}/protection/required_status_checks" 2>/dev/null)"; then
    # Merge our context into the existing required-status-checks list.
    if echo "${existing}" | jq -e --arg c "${CHECK_CONTEXT}" '.contexts // [] | index($c)' >/dev/null; then
      echo "  ✓ '${CHECK_CONTEXT}' is already a required status check — no change."
      continue
    fi
    strict="$(echo "${existing}" | jq -r '.strict // false')"
    contexts="$(echo "${existing}" | jq -c --arg c "${CHECK_CONTEXT}" '((.contexts // []) + [$c]) | unique')"
    gh api -X PATCH "repos/${REPO}/branches/${BRANCH}/protection/required_status_checks" \
      --input - >/dev/null <<JSON
{ "strict": ${strict}, "contexts": ${contexts} }
JSON
    echo "  ✓ Added '${CHECK_CONTEXT}' to the existing required status checks."
  else
    # No protection yet (or branch lacks a parent protection object): create a
    # minimal rule that requires only this check.
    gh api -X PUT "repos/${REPO}/branches/${BRANCH}/protection" \
      --input - >/dev/null <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ["${CHECK_CONTEXT}"] },
  "enforce_admins": null,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
    echo "  ✓ Created branch protection requiring '${CHECK_CONTEXT}'."
  fi
done

echo
echo "Done. A pull request whose '${CHECK_CONTEXT}' check is red can no longer be merged."
