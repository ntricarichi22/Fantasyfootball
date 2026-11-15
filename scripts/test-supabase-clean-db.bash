#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$root/scripts/lib/disposable-baseline.bash"
stage_ci_baseline "$root"
trap cleanup_ci_baseline EXIT

supabase db reset --local
supabase db lint --local --level error --fail-on error
supabase test db
export LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
node "$root/scripts/test-ai-db-concurrency.mjs"
node "$root/scripts/test-league-runtime-concurrency.mjs"
