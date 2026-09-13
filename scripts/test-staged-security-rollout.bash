#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hold="$(mktemp -d)"
generated="$root/supabase/migrations/000_ci_pre001_clean_database.sql"
state="$(mktemp)"; chmod 600 "$state"
export SMOKE_STATE_FILE="$state"
export AUTH_SESSION_SECRET="$(openssl rand -hex 32)"
export AUDIT_HASH_KEY="$(openssl rand -hex 32)"
restored=false
restore_pending() {
  if [[ $restored == false ]]; then
    find "$hold" -maxdepth 1 -type f -name '*.sql' -exec mv {} "$root/supabase/migrations/" \;
    restored=true
  fi
}
cleanup() { restore_pending; rm -f "$generated" "$state"; rm -rf "$hold"; }
trap cleanup EXIT

mapfile -t pending < <(find "$root/supabase/migrations" -maxdepth 1 -type f \
  \( -name '012_*.sql' -o -name '013_*.sql' -o -name '014_*.sql' -o -name '015_*.sql' -o -name '016_*.sql' -o -name '017_*.sql' -o -name '018_*.sql' -o -name '019_*.sql' -o -name '020_*.sql' \) -print | sort)
[[ ${#pending[@]} == 9 ]] || { echo "Expected exactly migrations 012-020 for staged rollout; found ${#pending[@]}." >&2; exit 1; }
cp "$root/supabase/baseline/pre001_clean_database.sql" "$generated"
mv "${pending[@]}" "$hold/"
[[ ! -e "$root/supabase/migrations/012_security_multitenancy_foundation.sql" ]] || { echo "Pending migrations were not isolated." >&2; exit 1; }

# This start creates only CI baseline 000 plus the deployed-history phase 001-011.
supabase start
SMOKE_PHASE=legacy "$root/scripts/test-auth-http-smoke.bash"
node "$root/scripts/seed-018-fixtures.mjs"

# Restore the reviewed files before reset; failure to restore is fatal.
restore_pending
for version in 012 013 014 015 016 017 018 019 020; do
  compgen -G "$root/supabase/migrations/${version}_*.sql" >/dev/null || { echo "Migration $version was not restored." >&2; exit 1; }
done
# Apply the reviewed delta to the same database so the schema-011 Auth and
# application fixtures prove the real migration/backfill transition.
supabase migration up --local
node "$root/scripts/test-018-fixtures.mjs"
"$root/scripts/test-commissioner-assignment.bash"
SMOKE_PHASE=upgrade "$root/scripts/test-auth-http-smoke.bash"

# Independently retain the clean-bootstrap reset/lint/pgTAP/concurrency proof.
"$root/scripts/test-supabase-clean-db.bash"
SMOKE_PHASE=current "$root/scripts/test-auth-http-smoke.bash"
