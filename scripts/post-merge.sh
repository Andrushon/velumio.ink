#!/bin/bash
set -e

pnpm install --frozen-lockfile

# Apply latest Drizzle schema to dev database
pnpm --filter @workspace/db run push-force

# Verify every Express route in api-server is documented in the OpenAPI spec.
pnpm --filter @workspace/api-spec run check-coverage
