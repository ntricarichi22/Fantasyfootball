# AI spending controls runbook

## Policy and coverage

- Reset convention: UTC calendar month, resetting at `00:00:00Z` on day one.
- Defaults: hard `$5.00` (5,000,000 USD micros) per authenticated user and a fixed `$60.00` pilot backstop. The aggregate does **not** track signup count.
- Covered provider paths: Historian (each tool turn), Draft Assistant, Personnel Advisor, Personnel Office, Door Beat, Storylines, Counter Read, and memo-sweep offer prose. A repository check requires the sole Anthropic URL to remain in the metered server module.
- No provider retry is performed. Historian tool turns are separately reserved/reconciled and therefore cannot escape the ceiling.
- Browser-triggered memo sweeps are charged to the authenticated caller. Only explicitly scheduled server work may set `background: true`; it fails closed unless `AI_BACKGROUND_USER_ID` identifies the budgeted service account. Both paths remain subject to a `$5` user ceiling and the fixed pilot ceiling.
- Non-AI behavior remains usable. Features with deterministic prose fall back; AI-only routes return an explanatory 401/413/429/503 response.

## Pricing and request assumptions

Anthropic's official [Sonnet 5 overview](https://platform.claude.com/docs/en/models/sonnet-5/overview) and [pricing reference](https://platform.claude.com/docs/en/about-claude/pricing) were reviewed on 2026-09-12. The standard model ID is `claude-sonnet-5`; prices are $2/MTok input and $10/MTok output. Standard prompt-cache prices are $2.50/MTok for a five-minute write, $4/MTok for a one-hour write, and $0.20/MTok for a read. The previously announced September 1 price increase will not occur. US-only inference costs 1.1x and is therefore unsupported until separately configured. These facts do not verify account credentials, taxes, contractual charges, or live connectivity.

The checked-in Sonnet 5 example uses USD micros per million tokens: `2000000`, `10000000`, `2500000`, `4000000`, and `200000`. All covered routes now use that exact model and explicitly disable adaptive thinking for their bounded prose/tool responses. Any future model remains fail-closed unless every required price is privately configured from a current official source. Prompt caching and paid server tools are rejected by the request envelope. Sonnet 5 requests reject custom `temperature`, `top_p`, and `top_k`.

The serialized request is limited by UTF-8 bytes, but that alone is not treated as the complete provider input bound. Reservations add 512 input tokens, rounded above Anthropic's documented 354-token no-tool and 474-token client-tool system overhead, and price all reserved input at the highest configured input/cache rate. `max_tokens` bounds ordinary and thinking output together. Missing, malformed, or unreported usage retains the full reservation. Reconciliation accounts separately for reported input, output, cache-write, and cache-read tokens; database accounting never clamps a higher observed charge down to the reservation.

Maximum reservation for one call is `((request-byte bound + 512) × highest input/cache price + output bound × output price) / 1,000,000`, rounded up to a USD micro. At standard Sonnet 5 prices this produces conservative upper bounds of about $0.071 for a 12,000/2,048 Historian turn, $0.062 for a 12,000/1,200 Draft Assistant turn, $0.038 for an 8,000/350 Personnel Advisor turn, and $0.040 for an 8,000/600 Storylines turn. These are reservation estimates, not measured bills; they exclude unsupported US-only inference, paid server tools, tax, and contract overhead.

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
