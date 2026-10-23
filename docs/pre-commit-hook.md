# Pre-commit Hook — Codegen Drift Check

## What it does

When you commit, if `lib/api-spec/openapi.yaml` is part of the staged files the
hook automatically runs `bash scripts/check-codegen.sh`.  
That script re-runs `pnpm codegen` and fails if any generated file in
`lib/api-client-react/src/generated` or `lib/api-zod/src/generated` differs
from what you have **staged** — meaning codegen output is out of sync with the
spec you're about to commit.

Drift is detected by comparing the **working tree against the index** (not HEAD),
so a correct commit — where you have staged `openapi.yaml` and its regenerated
output together — passes cleanly. Only a commit where the staged generated files
don't match what codegen produces will be rejected.

If `openapi.yaml` is **not** staged, the check is skipped entirely so normal
commits stay fast.

## Setup (new contributors)

The hook is managed by [simple-git-hooks](https://github.com/toplevel-labs/simple-git-hooks)
and is installed automatically after `pnpm install` via the `prepare` script.

```bash
pnpm install   # installs dependencies AND activates the pre-commit hook
```

If for some reason the hook is missing (e.g. after manually cloning without
running `pnpm install`), activate it manually:

```bash
pnpm simple-git-hooks
```

## Bypassing the hook

If you need to commit a work-in-progress change to `openapi.yaml` without
fixing drift first, use git's `--no-verify` flag:

```bash
git commit --no-verify -m "wip: openapi changes"
```

Bypassing should be the exception, not the rule — drift will still be caught in CI.

## Files involved

| File | Purpose |
|------|---------|
| `scripts/pre-commit.sh` | Entry point: checks whether `openapi.yaml` is staged, then delegates to `check-codegen.sh` |
| `scripts/check-codegen.sh` | Runs `pnpm codegen` and fails if generated files changed |
| `lib/api-spec/openapi.yaml` | Source of truth for the API contract |
| `package.json` → `simple-git-hooks` | Wires the hook into git |
