#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to a read-only production connection string}"
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to the disposable restored database}"
: "${RECOVERY_TARGET_CONFIRM:?Set RECOVERY_TARGET_CONFIRM=DISPOSABLE-NONPRODUCTION}"

if [[ $RECOVERY_TARGET_CONFIRM != DISPOSABLE-NONPRODUCTION ]]; then
  echo "Refusing: target has not been confirmed disposable/nonproduction" >&2
  exit 2
fi

sql="$(dirname "$0")/recovery-validation.sql"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077

identity() {
  psql "$1" -XAt --set=ON_ERROR_STOP=1 --set=TRANSACTION_READ_ONLY=on \
    --command="select coalesce(inet_server_addr()::text, 'local') || ':' || inet_server_port() || '/' || current_database()"
}

source_identity=$(identity "$SOURCE_DATABASE_URL")
target_identity=$(identity "$TARGET_DATABASE_URL")
if [[ $source_identity == "$target_identity" ]]; then
  echo "Refusing: source and target resolve to the same database" >&2
  exit 2
fi

psql "$SOURCE_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --set=TRANSACTION_READ_ONLY=on --file="$sql" >"$work/source"
psql "$TARGET_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --set=TRANSACTION_READ_ONLY=on --file="$sql" >"$work/target"

if ! diff -u "$work/source" "$work/target"; then
  echo "Restore validation failed: privacy-safe manifests differ" >&2
  exit 1
fi

echo "Restore validation passed: schema, object counts, exact row totals, Auth metadata, and Storage metadata match."
