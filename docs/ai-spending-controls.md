# AI spending controls runbook

## Policy and coverage

- Reset convention: UTC calendar month, resetting at `00:00:00Z` on day one.
- Defaults: hard `$5.00` (5,000,000 USD micros) per authenticated user and a fixed `$60.00` pilot backstop. The aggregate does **not** track signup count.
- Covered provider paths: Historian (each tool turn), Draft Assistant, Personnel Advisor, Personnel Office, Door Beat, Storylines, Counter Read, and memo-sweep offer prose. A repository check requires the sole Anthropic URL to remain in the metered server module.
- No provider retry is performed. Historian tool turns are separately reserved/reconciled and therefore cannot escape the ceiling.
- Memo-sweep prose is background work and fails closed unless `AI_BACKGROUND_USER_ID` identifies the explicitly budgeted account. The non-AI fallback remains available. The configured account is subject to both the same `$5` user ceiling and the fixed pilot ceiling.
- Non-AI behavior remains usable. Features with deterministic prose fall back; AI-only routes return an explanatory 401/413/429/503 response.

## Pricing and request assumptions

No provider price was committed: network price lookup was unavailable during implementation, and `claude-sonnet-5` could not be independently verified as a currently priced provider identifier. Deployment must set both input and output USD-micros-per-million-token variables for every model. Missing/invalid values stop requests before provider dispatch. UTF-8 request bytes conservatively cap estimated input tokens; provider `max_tokens` caps output. Failed or unreported usage is charged at the full reservation. Reported usage is reconciled but never above the pre-dispatch reservation.

Maximum reservation for one call is `(input bound × configured input price + output bound × configured output price) / 1,000,000`, rounded up to a USD micro. Historian and Draft Assistant reserve at most 12,000 input-token units plus respectively 2,048 and 1,200 output tokens per provider turn. Personnel features reserve 5,000–8,000 input units and 220–600 output tokens. These formulas, rather than stale dollar examples, are the authoritative common-action estimates until official prices are verified and configured.

## First deployment (do not run against production without review)

1. Review and apply `supabase/migrations/013_ai_usage_limits.sql` through the normal migration pipeline.
2. Verify the migration's final `information_schema` and accounting queries.
3. Set `AI_MONTHLY_USER_BUDGET_MICROS=5000000`, `AI_MONTHLY_PILOT_BUDGET_MICROS=60000000`, throttling values, and verified price variables from the provider's official pricing page.
4. Set `AI_BACKGROUND_USER_ID` only if memo-sweep AI is intended; otherwise it remains disabled and deterministic prose is used.
5. Deploy application code after the migration, then call authenticated `GET /api/ai/quota` and make one low-cost request.

## Re-sync / operations and monitoring interface

No monthly job is needed: every reservation derives its UTC month atomically. `GET /api/ai/quota` returns user/pilot used and remaining USD micros plus `month` and `reset_at`; it never exposes prompts. Monitoring may read aggregate rows from `ai_usage_reservations` using server administrative access only. Reservation records contain feature/model/cost/outcome metadata, never prompt or response contents.

Stale `reserved` rows deliberately remain fully charged and consume a concurrency slot (fail-safe). An operator should investigate provider/application state before reconciling one; no automatic release can silently undercount a dispatched request.

## Integration dependencies

This branch changes shared AI route and client call sites. The authentication/security branch must preserve signed application-session cookies via `authenticatedAiFetch` and server verification in `authenticatedAiUser`; client-supplied user IDs and bearer identity are not accepted. The monitoring branch can consume the quota endpoint or reservation metadata, but should not grant clients direct table/RPC access. No live schema, policies, deployment, credentials, or provider resources were changed.
