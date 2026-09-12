#!/usr/bin/env bash
set -euo pipefail
: "${READ_ONLY_DATABASE_URL:?Set a read-only source URL}"
: "${ARCHIVE_DIR:?Set a private archive directory}"
mkdir -p "$ARCHIVE_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$ARCHIVE_DIR/cfc-cleanup-candidates-$stamp.dump"
# Exact existing relations from the 2026-09-12 read-only catalog capture.
# All are archived for recovery evidence; inclusion is not a deletion claim.
tables=(slp_raw_global slp_raw_smoke flea_raw_global flea_raw_smoke mfl_raw_global mfl_raw_smoke watchlist)
args=(); for table in "${tables[@]}"; do args+=(--table="public.$table"); done
pg_dump "$READ_ONLY_DATABASE_URL" --format=custom --no-owner --no-privileges "${args[@]}" --file="$out"
pg_restore --list "$out" > "$out.list"
sha256sum "$out" "$out.list" > "$out.sha256"
printf 'Archive created: %s\nRestore verification is still required in an approved isolated target.\n' "$out"
