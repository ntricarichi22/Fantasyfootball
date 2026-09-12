#!/usr/bin/env bash
set -euo pipefail
: "${READ_ONLY_DATABASE_URL:?Set a read-only source URL}"
: "${ARCHIVE_DIR:?Set a private archive directory}"
mkdir -p "$ARCHIVE_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$ARCHIVE_DIR/cfc-cleanup-candidates-$stamp.dump"
tables=(league_seasons league_users league_teams league_roster_snapshots league_roster_players league_drafts league_draft_picks league_matchups league_matchup_teams league_transactions league_transaction_assets league_traded_picks league_playoff_bracket_games league_final_standings league_champions slp_raw_global slp_raw_smoke flea_raw_global flea_raw_smoke mfl_raw_global mfl_raw_smoke watchlist cfc_value_upload_staging)
args=(); for table in "${tables[@]}"; do args+=(--table="public.$table"); done
pg_dump "$READ_ONLY_DATABASE_URL" --format=custom --no-owner --no-privileges "${args[@]}" --file="$out"
pg_restore --list "$out" > "$out.list"
sha256sum "$out" "$out.list" > "$out.sha256"
printf 'Archive created: %s\nRestore verification is still required in an approved isolated target.\n' "$out"
