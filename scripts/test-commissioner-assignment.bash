#!/usr/bin/env bash
set -euo pipefail
db="${LOCAL_DATABASE_URL:?LOCAL_DATABASE_URL is required}"
script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/database/assign-commissioner.sql"
user_id=91000000-0000-0000-0000-000000000001
actor_id=91000000-0000-0000-0000-000000000002
league_id=commissioner-script-fixture

psql "$db" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) VALUES
('$user_id','00000000-0000-0000-0000-000000000000','authenticated','authenticated','commissioner-fixture@example.invalid','',now(),now()),
('$actor_id','00000000-0000-0000-0000-000000000000','authenticated','authenticated','operator-fixture@example.invalid','',now(),now());
INSERT INTO public.league_memberships(user_id,league_id,roster_id,role)
VALUES ('$user_id','$league_id','fixture-roster','member');
SQL

psql "$db" -v ON_ERROR_STOP=1 -v league_id="$league_id" -v user_id="$user_id" -v actor_user_id="$actor_id" -f "$script" >/dev/null
[[ "$(psql "$db" -Atc "SELECT role FROM public.league_memberships WHERE user_id='$user_id'")" == commissioner ]]
[[ "$(psql "$db" -Atc "SELECT count(*) FROM public.security_audit_log WHERE actor_user_id='$actor_id' AND action='assign_commissioner' AND outcome='success'")" == 1 ]]

psql "$db" -v ON_ERROR_STOP=1 -c "UPDATE public.league_memberships SET role='member' WHERE user_id='$user_id'; DELETE FROM public.security_audit_log WHERE actor_user_id='$actor_id';" >/dev/null
if psql "$db" -v ON_ERROR_STOP=1 -v league_id="$league_id" -v user_id="92000000-0000-0000-0000-000000000009" -v actor_user_id="$actor_id" -f "$script" >/dev/null 2>&1; then
  echo "zero-match commissioner assignment unexpectedly succeeded" >&2; exit 1
fi
[[ "$(psql "$db" -Atc "SELECT role FROM public.league_memberships WHERE user_id='$user_id'")" == member ]]
[[ "$(psql "$db" -Atc "SELECT count(*) FROM public.security_audit_log WHERE actor_user_id='$actor_id' AND action='assign_commissioner'")" == 0 ]]

# The exact user+league selector cannot yield multiple rows: prove the backing
# primary key rejects that state rather than manufacturing an impossible table.
if psql "$db" -v ON_ERROR_STOP=1 -c "INSERT INTO public.league_memberships(user_id,league_id,roster_id) VALUES('$user_id','$league_id','other-roster')" >/dev/null 2>&1; then
  echo "duplicate user+league membership unexpectedly succeeded" >&2; exit 1
fi
echo "Commissioner assignment success, audit, zero-match rollback and uniqueness checks passed."
