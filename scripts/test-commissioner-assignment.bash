#!/usr/bin/env bash
set -euo pipefail
db="${LOCAL_DATABASE_URL:?LOCAL_DATABASE_URL is required}"
script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/database/assign-commissioner.sql"
league_id=commissioner-script-fixture

if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  eval "$(supabase status -o env | sed -nE '/^(API_URL|SERVICE_ROLE_KEY)=/p')"
  export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
  export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
fi
mapfile -t auth_ids < <(node "$(dirname "$script")/../create-commissioner-auth-fixtures.mjs")
[[ ${#auth_ids[@]} == 2 ]] || { echo "Auth fixture creation did not return two users" >&2; exit 1; }
user_id="${auth_ids[0]}"
actor_id="${auth_ids[1]}"

psql "$db" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO public.league_memberships(user_id,league_id,roster_id,role)
VALUES ('$user_id','$league_id','fixture-roster','member');
SQL

psql "$db" -v ON_ERROR_STOP=1 -v league_id="$league_id" -v user_id="$user_id" -v actor_user_id="$actor_id" -f "$script" >/dev/null
[[ "$(psql "$db" -Atc "SELECT role FROM public.league_memberships WHERE user_id='$user_id'")" == commissioner ]]
[[ "$(psql "$db" -Atc "SELECT count(*) FROM public.security_audit_log WHERE actor_user_id='$actor_id' AND action='assign_commissioner' AND outcome='success'")" == 1 ]]

psql "$db" -v ON_ERROR_STOP=1 -c "UPDATE public.league_memberships SET role='member' WHERE user_id='$user_id'" >/dev/null
audit_sql="SELECT count(*) FROM public.security_audit_log WHERE actor_user_id='$actor_id' AND action='assign_commissioner'"
audit_baseline="$(psql "$db" -Atc "$audit_sql")"
# The update occurs before the audit insert in the real operator script. An
# invalid actor makes that insert fail and must roll the role change back while
# retaining the append-only audit baseline.
if psql "$db" -v ON_ERROR_STOP=1 -v league_id="$league_id" -v user_id="$user_id" -v actor_user_id="not-a-uuid" -f "$script" >/dev/null 2>&1; then
  echo "invalid-actor commissioner assignment unexpectedly succeeded" >&2; exit 1
fi
[[ "$(psql "$db" -Atc "SELECT role FROM public.league_memberships WHERE user_id='$user_id'")" == member ]]
[[ "$(psql "$db" -Atc "$audit_sql")" == "$audit_baseline" ]]
if psql "$db" -v ON_ERROR_STOP=1 -v league_id="$league_id" -v user_id="92000000-0000-0000-0000-000000000009" -v actor_user_id="$actor_id" -f "$script" >/dev/null 2>&1; then
  echo "zero-match commissioner assignment unexpectedly succeeded" >&2; exit 1
fi
[[ "$(psql "$db" -Atc "SELECT role FROM public.league_memberships WHERE user_id='$user_id'")" == member ]]
[[ "$(psql "$db" -Atc "$audit_sql")" == "$audit_baseline" ]]

# The exact user+league selector cannot yield multiple rows: prove the backing
# primary key rejects that state rather than manufacturing an impossible table.
if psql "$db" -v ON_ERROR_STOP=1 -c "INSERT INTO public.league_memberships(user_id,league_id,roster_id) VALUES('$user_id','$league_id','other-roster')" >/dev/null 2>&1; then
  echo "duplicate user+league membership unexpectedly succeeded" >&2; exit 1
fi
echo "Commissioner assignment success, audit, zero-match rollback and uniqueness checks passed."
