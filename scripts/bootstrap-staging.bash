#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
[[ "${CI:-}" == "true" && "${STAGING_LOCAL:-}" == "1" ]] || { echo "Bootstrap is restricted to disposable CI." >&2; exit 1; }
source "$root/scripts/lib/disposable-baseline.bash"
stage_ci_baseline "$root"
trap cleanup_ci_baseline EXIT
# Only reviewed schema definitions and numbered migrations, never a production dump.
supabase start
supabase db lint --local --level error --fail-on error
