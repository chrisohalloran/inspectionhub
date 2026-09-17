#!/usr/bin/env bash
# Idempotent Cloud Agent install — safe to rerun on prepared Builds.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

corepack enable
corepack prepare pnpm@10.29.3 --activate

pnpm install --frozen-lockfile

# Web e2e gate (CI installs Chromium with system deps).
pnpm exec playwright install --with-deps chromium

echo "InspectionHub cloud environment install complete."
