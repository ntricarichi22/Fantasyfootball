# AGENTS.md

## Working style
- Keep responses short.
- Do not invent Supabase tables or columns.
- Before writing SQL, inspect the live schema first.
- Use only confirmed table and column names.
- Produce full rerunnable SQL scripts in one block.
- Prefer low-risk changes.
- Do not refactor unrelated code.

## This repo
- Canonical warehouse tables are the `ff_master_*` tables already built in Supabase.
- For draft history:
  - `ff_master_draft_picks` = actual draft results only
  - `ff_master_transactions` + `ff_master_transaction_items` = traded-pick history
- Sleeper actual draft results are the remaining gap.
- Known Sleeper league ids:
  - 2024: `1040100278152646656`
  - 2025: `1183585976810295296`

## Required behavior for this task
- Build an automated Sleeper draft-results sync.
- Create a new mirror table for Sleeper draft results.
- Rebuild `ff_master_draft_picks` from:
  - Flea actual draft results
  - MFL actual draft results
  - Sleeper actual draft results
- Do not use original/current pick ownership logic in `ff_master_draft_picks` beyond selected-by franchise for actual results.
- Add validation queries after the build.

## SQL rules
- Always inspect `information_schema.columns` first before writing SQL that touches existing tables.
- Never assume a field exists because it “probably should.”
- Use full copy-paste rerunnable SQL scripts.
- If changing a constraint or index, make the script idempotent where possible.

## Safety rails
- Do not drop or alter existing production tables unless the task explicitly requires it.
- Do not rewrite unrelated warehouse logic.
- Keep new objects narrowly scoped to the task.

## Deliverable format
- Give:
  - one full SQL migration
  - the exact files to add/change
  - the full code
  - a short runbook for first sync and re-sync
