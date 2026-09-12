#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
generated="$root/supabase/migrations/000_ci_pre001_clean_database.sql"
cleanup() { rm -f "$generated"; }
trap cleanup EXIT
if [[ -e "$generated" ]]; then
  cmp -s "$root/supabase/baseline/pre001_clean_database.sql" "$generated" || {
    echo "Staged CI baseline differs from reviewed source." >&2
    exit 1
  }
else
  cp "$root/supabase/baseline/pre001_clean_database.sql" "$generated"
fi

supabase db reset --local
supabase db lint --local --level error --fail-on error
supabase test db
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" \
  node "$root/scripts/test-ai-db-concurrency.mjs"
