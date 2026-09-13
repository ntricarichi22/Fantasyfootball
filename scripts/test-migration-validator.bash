#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
baseline="$work/baseline.sql"; printf '%s\n' '-- fixture baseline' >"$baseline"
run() { MIGRATIONS_DIR="$1" BASELINE_FILE="$baseline" "$root/scripts/validate-supabase-migrations.bash" >/dev/null 2>&1; }
fixture() { rm -rf "$work/migrations"; mkdir "$work/migrations"; }
fixture; printf 'select 1;\n' >"$work/migrations/001_valid.sql"; run "$work/migrations"
fixture; printf 'select 1;\n' >"$work/migrations/bad.sql"; ! run "$work/migrations"
fixture; printf 'select 1;\n' >"$work/migrations/001_one.sql"; printf 'select 2;\n' >"$work/migrations/001_two.sql"; ! run "$work/migrations"
fixture; printf 'select 1;\n' >"$work/migrations/1_wrong_width.sql"; ! run "$work/migrations"
fixture; printf '<<<<<<< conflict\n' >"$work/migrations/001_conflict.sql"; ! run "$work/migrations"
fixture; : >"$work/migrations/001_empty.sql"; ! run "$work/migrations"
echo "Migration validator rejection fixtures passed."
