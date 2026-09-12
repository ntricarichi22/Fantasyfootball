# Security foundations coordinated rollout

No step in this document has been executed. Production changes require the existing
`supabase-production` reviewer approval.

## Why ordering matters

Vercel automatically deploys a merged application commit, while the database job waits
for a reviewer. The application must therefore tolerate schema version `011` until the
reviewer applies `012`–`017`. Conversely, after `015` revokes old direct privileges, an
old application rollback must not depend on anonymous database writes.

## Pre-merge gates

1. Require successful CI run `34701863673` at `b49e0f8` as the current database and
   HTTP/Auth proof, plus the new staged schema-011 transition on the exact final head; do not approve
   based only on app tests.
2. In Vercel's server-only production environment, configure a new independent
   `AUTH_SESSION_SECRET` and 32+ byte `AUDIT_HASH_KEY`. Until the signing key exists,
   the code can use the already-server-only service-role key solely as a compatibility
   signer, but this is not acceptable as the final key separation.
3. Configure integer USD-micros-per-million-token input/output prices for every exact
   deployed Anthropic model from current official provider pricing. Do not enable AI
   when a price or model identifier is unverified. Keep user/pilot ceilings at
   `5000000` and `60000000` respectively. Configure `AI_BACKGROUND_USER_ID` only when
   scheduled prose is desired and deliberately charged to that account.
   Keep email alerts disabled until a verified Resend sender, private provider key,
   and approved private recipient setting are present. No destination belongs in Git.
4. Preserve the read-only preflight evidence: current production `draft_state` contains exactly one distinct league.
   Migrations `012` and `015` intentionally abort otherwise rather than guessing the
   membership or historical draft-log league.
5. Review the membership backfill preview using aggregate counts only. It joins
   existing confirmed Auth emails to `team_email_map`, inserts only missing `member`
   rows, and never overwrites roles. Prepare the owner's explicit commissioner-role
   change for after `012`; do not assign global `admin` unless separately approved.
6. Confirm every current user mapped by `team_email_map` is represented or has an
   owner-approved remediation. This ensures Realtime SELECT remains available when
   `015` replaces public policies with membership scope.
7. Review the `016` invitation preview. Existing mapped Auth users should already be
   consumed through their `012` membership; only genuinely unaccepted invitations
   may remain active. Future revocation must use the trusted service operation that
   revokes the invitation and removes membership atomically—not deletion alone.

## Merge and reviewer-gated sequence

1. Merge only the exact SHA that passed application **and disposable database** checks.
2. Vercel may deploy that SHA first. At schema `011`, login finalization detects only
   the missing `league_memberships` relation, issues a signed member session from the
   existing invitation map, and skips membership/audit persistence. Protected routes
   still revalidate the Auth user, accept only that exact absent relation, and downgrade
   the compatibility session to `member`; other database errors fail closed. Non-AI
   features remain available; AI fails closed until accounting exists.
   Credential-free CI must prove this exact interval by physically withholding
   migrations `012`–`017`, not by fabricating missing-relation responses.
3. The reviewer verifies the tested SHA and dry-run history shows remote `001`–`011`
   and local pending `012`–`017`, with no repair, baseline, drop, or unexpected SQL.
4. Approve the serialized database job. `012` creates/backfills memberships; `013`
   adds AI accounting; `014` adds protected audit storage; `015` scopes draft history
   and revokes broad Data API access; `016` adds one-time invitation acceptance,
   durable revocation semantics, and shared pseudonymous auth throttling; `017`
   replaces the lint-invisible temporary-table rebuild while preserving Flea/MFL
   results. Validation queries must match the reviewed results.
5. Apply the prepared owner commissioner membership through a separately reviewed,
   authenticated administrative operation. Have all users sign in again so session
   roles reflect durable membership.
6. Exercise a non-sensitive smoke matrix: login/logout/reset, own versus foreign team,
   trade participants versus nonparticipants, commissioner same-league action, draft
   Realtime read, server draft write, AI quota denial/success, and admin denial.

## Rollback

- **Before `015`:** roll the application back to the preceding Vercel deployment if
  needed; additive `012`–`014` objects can remain. Do not drop audit/accounting data.
- **After `015`:** do not roll back to code that expects anonymous/direct table writes.
  Prefer a forward corrective app build. If a critical read regression requires
  temporary database relief, use a narrowly scoped, reviewed forward migration for the
  exact relation/role—never restore the former schema-wide grants or PUBLIC-true policy.
- AI can be disabled without affecting non-AI features by removing/invalidating its
  verified price configuration; requests then fail before provider dispatch.
- A database restore is last resort and only follows the recovery runbook. Never reset
  or repair migration history automatically.
