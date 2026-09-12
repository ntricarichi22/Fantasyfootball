#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hold="$(mktemp -d)"
generated="$root/supabase/migrations/000_ci_pre001_clean_database.sql"
restored=false
restore_pending() {
  if [[ $restored == false ]]; then
    find "$hold" -maxdepth 1 -type f -name '*.sql' -exec mv {} "$root/supabase/migrations/" \;
    restored=true
  fi
}
cleanup() { restore_pending; rm -f "$generated"; rm -rf "$hold"; }
trap cleanup EXIT

mapfile -t pending < <(find "$root/supabase/migrations" -maxdepth 1 -type f \
  \( -name '012_*.sql' -o -name '013_*.sql' -o -name '014_*.sql' -o -name '015_*.sql' -o -name '016_*.sql' -o -name '017_*.sql' -o -name '018_*.sql' \) -print | sort)
[[ ${#pending[@]} == 7 ]] || { echo "Expected exactly migrations 012-018 for staged rollout; found ${#pending[@]}." >&2; exit 1; }
cp "$root/supabase/baseline/pre001_clean_database.sql" "$generated"
mv "${pending[@]}" "$hold/"
[[ ! -e "$root/supabase/migrations/012_security_multitenancy_foundation.sql" ]] || { echo "Pending migrations were not isolated." >&2; exit 1; }

# This start creates only CI baseline 000 plus the deployed-history phase 001-011.
supabase start
SMOKE_PHASE=legacy "$root/scripts/test-auth-http-smoke.bash"

# Restore the reviewed files before reset; failure to restore is fatal.
restore_pending
for version in 012 013 014 015 016 017 018; do
  compgen -G "$root/supabase/migrations/${version}_*.sql" >/dev/null || { echo "Migration $version was not restored." >&2; exit 1; }
done
"$root/scripts/test-supabase-clean-db.bash"
SMOKE_PHASE=current "$root/scripts/test-auth-http-smoke.bash"
