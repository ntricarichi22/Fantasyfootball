#!/usr/bin/env bash
set -euo pipefail
required=(NEXT_PUBLIC_SLEEPER_LEAGUE_ID NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY AUTH_SESSION_SECRET AUDIT_HASH_KEY ANTHROPIC_API_KEY
  AI_MONTHLY_USER_BUDGET_MICROS AI_MONTHLY_PILOT_BUDGET_MICROS
  AI_PRICE_CLAUDE_SONNET_5_INPUT_MICROS_PER_MTOK AI_PRICE_CLAUDE_SONNET_5_OUTPUT_MICROS_PER_MTOK
  AI_PRICE_CLAUDE_SONNET_5_CACHE_WRITE_5M_MICROS_PER_MTOK
  AI_PRICE_CLAUDE_SONNET_5_CACHE_WRITE_1H_MICROS_PER_MTOK AI_PRICE_CLAUDE_SONNET_5_CACHE_READ_MICROS_PER_MTOK)
for name in "${required[@]}"; do [[ -n "${!name:-}" ]] || { echo "Missing private setting: $name" >&2; exit 1; }; done
[[ ${NEXT_PUBLIC_SLEEPER_LEAGUE_ID} == 1328902558617473024 ]] || { echo "League setting is not the verified 2026 league." >&2; exit 1; }
[[ ${#AUTH_SESSION_SECRET} -ge 32 && ${#AUDIT_HASH_KEY} -ge 32 ]] || { echo "Signing/audit keys must each be at least 32 characters." >&2; exit 1; }
[[ $AUTH_SESSION_SECRET != "$AUDIT_HASH_KEY" && $AUTH_SESSION_SECRET != "$SUPABASE_SERVICE_ROLE_KEY" && $AUDIT_HASH_KEY != "$SUPABASE_SERVICE_ROLE_KEY" ]] || { echo "Signing, audit, and service-role secrets must be independent." >&2; exit 1; }
[[ $AI_MONTHLY_USER_BUDGET_MICROS == 5000000 && $AI_MONTHLY_PILOT_BUDGET_MICROS == 60000000 ]] || { echo "AI hard ceilings differ from approved values." >&2; exit 1; }
expected=(2000000 10000000 2500000 4000000 200000)
actual=("$AI_PRICE_CLAUDE_SONNET_5_INPUT_MICROS_PER_MTOK" "$AI_PRICE_CLAUDE_SONNET_5_OUTPUT_MICROS_PER_MTOK"
 "$AI_PRICE_CLAUDE_SONNET_5_CACHE_WRITE_5M_MICROS_PER_MTOK" "$AI_PRICE_CLAUDE_SONNET_5_CACHE_WRITE_1H_MICROS_PER_MTOK"
 "$AI_PRICE_CLAUDE_SONNET_5_CACHE_READ_MICROS_PER_MTOK")
[[ ${actual[*]} == "${expected[*]}" ]] || { echo "Sonnet 5 standard price configuration differs from the reviewed envelope." >&2; exit 1; }
[[ ${SECURITY_EMAIL_ALERTS_ENABLED:-false} == false ]] || {
  for name in SECURITY_ALERT_EMAIL_TO SECURITY_ALERT_EMAIL_FROM RESEND_API_KEY; do
    [[ -n "${!name:-}" ]] || { echo "Email activation missing private setting: $name" >&2; exit 1; }
  done
  echo "Refusing rollout preflight while email delivery is enabled; perform the separate nonproduction alert test first." >&2
  exit 1
}
if [[ -n ${AI_BACKGROUND_USER_ID:-} && ! $AI_BACKGROUND_USER_ID =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "AI_BACKGROUND_USER_ID must be empty or a reviewed UUID." >&2; exit 1
fi
echo "Security rollout environment shape passed without printing secret values; email remains disabled."
