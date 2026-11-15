#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
log="$(mktemp)"
app_pid=""
cleanup() {
  if [[ -n "$app_pid" ]]; then kill "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true; fi
  if [[ "${1:-0}" != 0 ]]; then cat "$log" >&2; fi
  rm -f "$log"
}
trap 'code=$?; cleanup "$code"; exit "$code"' EXIT

# Values come only from the disposable local stack. Random keys are ephemeral.
eval "$(supabase status -o env | sed -nE '/^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|INBUCKET_URL)=/p')"
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export NEXT_PUBLIC_SLEEPER_LEAGUE_ID="1328902558617473024"
export CFC_LEAGUE_ID="$NEXT_PUBLIC_SLEEPER_LEAGUE_ID"
export AUTH_SESSION_SECRET="${AUTH_SESSION_SECRET:-$(openssl rand -hex 32)}"
export AUDIT_HASH_KEY="${AUDIT_HASH_KEY:-$(openssl rand -hex 32)}"
export SECURITY_EMAIL_ALERTS_ENABLED=false
export LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
export APP_BASE_URL="http://127.0.0.1:3000"
export INBUCKET_URL="${INBUCKET_URL:-http://127.0.0.1:54324}"

export VERCEL_GIT_COMMIT_SHA="${VERCEL_GIT_COMMIT_SHA:-$(git -C "$root" rev-parse HEAD)}"
export NEXT_PUBLIC_APP_ENV=local
if [[ "${LOCAL_APP_MODE:-dev}" == "production" ]]; then
  "$root/node_modules/.bin/next" build >"$log" 2>&1
  "$root/node_modules/.bin/next" start --hostname 127.0.0.1 --port 3000 >>"$log" 2>&1 &
else
  "$root/node_modules/.bin/next" dev --hostname 127.0.0.1 --port 3000 >"$log" 2>&1 &
fi
app_pid=$!
for _ in $(seq 1 90); do
  if curl --fail --silent --output /dev/null "$APP_BASE_URL/login"; then break; fi
  kill -0 "$app_pid" 2>/dev/null || { cat "$log" >&2; exit 1; }
  sleep 1
done
curl --fail --silent --output /dev/null "$APP_BASE_URL/login"
export STAGING_LOCAL=1
export STAGING_APP_URL="$APP_BASE_URL"
export STAGING_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL"
export STAGING_DATABASE_URL="$LOCAL_DATABASE_URL"
export STAGING_COMMIT_SHA="$VERCEL_GIT_COMMIT_SHA"
node "$1"
