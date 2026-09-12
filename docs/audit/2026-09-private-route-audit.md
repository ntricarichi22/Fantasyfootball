# Private route authorization audit

Reviewed against the combined PR153 tree after security head `b90603a`.
Server authorization is always the signed application session refreshed from
current membership; browser team names, email strings, roster cookies, and
request body roster IDs are not authorization.

## Ownership-scoped routes

Inbox threads/messages/status/list/read/counter feeds, strategy and attachment
writes, player values, team identity/logo, onboarding completion, Builder,
Studio, advisor, storylines, partner-fit, office response, trade-pass memory,
mock draft/trade-up/trade-back, active-team claims, and draft reads verify the
current session league and acting roster. Offer/thread handlers additionally
load the resource and verify participation before returning or mutating it.

## Role- or secret-scoped routes

Draft-state mutation uses current commissioner/admin membership. Draft-log
undo uses the same stable role. Ingest/build/internal refresh, draft tick,
accepted-trade reconciliation, and memo sweeps use the centralized admin/cron
boundary. None accepts a team display name as authority.

## Authentication infrastructure and bounded AI

Auth prepare/signup/finalize/login/logout routes are necessarily reachable
before an application session and enforce their invitation/confirmation
contracts. Development login is environment-disabled outside development.
Historian and Draft Assistant dispatch through the metered server boundary,
which refreshes current membership before model dispatch or SQL continuation.
Generic deterministic prose fallbacks still require a current application
session where they accept team/deal context.

## Public, non-private reads

Crest/avatar image rendering and security failure aggregation expose no league
records. No route using the service client to return or mutate private league
data remains authorized solely by a browser identity.

The disposable HTTP fixture exercises absent, forged, tampered, revoked,
cross-league, foreign-roster, commissioner-own-roster, Builder, strategy,
mock-draft adapter, and draft-state boundaries. This is CI evidence only; it is
not production rollout evidence.

## Independent review findings resolved

- **A — trade list:** only `inbox` and `sent` are accepted; empty/malformed tabs
  fail before query construction. List and single-offer queries are explicitly
  participant-scoped, and foreign single IDs return a non-enumerating response.
- **B — AI counter:** the current-league thread is loaded first and the owned
  roster must be an actual participant. The pending offer must contain exactly
  that thread's pair before any dossiers, strategies, rosters, or values load.
- **C — targets:** only the caller's strategy and attachment rows are loaded.
  Counterparty assets use neutral public availability; saved counterpart
  profile/attachment inputs are not returned.
- **D — insider:** active negotiation chains are selected only from threads in
  which the caller participates. Completed-deal headlines and explicit public
  availability remain league activity; unrelated open offers are not loaded.
- **E — commissioner:** migration 012 deliberately backfills members only. A
  private direct-database operator script assigns exactly one verified
  `(user_id, league_id)` membership after review; no email/team-name heuristic
  or application self-promotion path exists. pgTAP covers rename stability,
  member denial, and self-promotion denial; existing revocation tests cover
  removal of authority.
