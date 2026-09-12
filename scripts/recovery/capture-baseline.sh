#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to a read-only production connection string}"

output=${1:-recovery-baseline.txt}
umask 077

psql "$SOURCE_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --set=TRANSACTION_READ_ONLY=on \
  --file="$(dirname "$0")/recovery-validation.sql" >"$output"

printf 'Wrote privacy-safe recovery baseline to %s\n' "$output"
