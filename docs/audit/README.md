# September 2026 source-of-truth audit

Working notes for the single-source-of-truth refactor and Supabase cleanup.

- `2026-09-source-of-truth-plan.md` — the approved plan: canonical feeds, refactor order, database tiers, verification.
- `2026-09-decision-sheet.json` — every verified divergence as a decision card (symptom, cause, evidence, options). The owner records choices on the published decision sheet artifact; this file is the source the sheet is rendered from.

Live facts established on 2026-09-12 (Sleeper public API):

- 2026 CFC Sleeper league id: `1328902558617473024` (draft `1328902558630031360`, status `complete`, 36 picks across 3 rounds).
- 2025 CFC Sleeper league id: `1183585976810295296` (the id listed in AGENTS.md as "2025"; status `complete`).
- Sleeper still lists completed-season (2026) traded picks in `/traded_picks`, so a completed draft must be treated as spending the whole season.

Resuming in a new session: check out branch `claude/brave-lovelace-gq28fx`, read the two files above, then read the owner's choices from the decision sheet artifact's `decisions` collection.
