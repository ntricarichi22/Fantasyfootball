#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migrations_dir="${MIGRATIONS_DIR:-$root/supabase/migrations}"
baseline_file="${BASELINE_FILE:-$root/supabase/baseline/pre001_clean_database.sql}"
for command in find sort awk; do
  command -v "$command" >/dev/null || { echo "Required validator command is unavailable: $command" >&2; exit 2; }
done

mapfile -t files < <(find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort)
(( ${#files[@]} > 0 )) || { echo "No Supabase migrations found." >&2; exit 1; }

declare -A versions=()
previous_num=-1
for file in "${files[@]}"; do
  if [[ ! "$file" =~ ^([0-9]{3})_[a-z0-9_]+\.sql$ ]]; then
    echo "Invalid migration filename: $file" >&2; exit 1
  fi
  version="${BASH_REMATCH[1]}"; version_num=$((10#$version))
  if [[ -n "${versions[$version]:-}" ]]; then
    echo "Duplicate migration version $version: ${versions[$version]} and $file" >&2; exit 1
  fi
  (( version_num > previous_num )) || { echo "Migration versions are not strictly increasing." >&2; exit 1; }
  versions[$version]="$file"; previous_num=$version_num
  [[ -s "$migrations_dir/$file" ]] || { echo "Empty migration: $file" >&2; exit 1; }
done

if find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -exec \
  awk '/^(<<<<<<<|=======|>>>>>>>)/ { print FILENAME ":" FNR ": merge-conflict marker"; found=1 } END { exit(found ? 0 : 1) }' {} +; then
  echo "Merge-conflict marker found in migrations." >&2; exit 1
fi

[[ -s "$baseline_file" ]] || { echo "Missing CI-only pre-001 baseline." >&2; exit 1; }
[[ ! -e "$migrations_dir/000_ci_pre001_clean_database.sql" ]] || {
  echo "Generated CI baseline must not be committed as a production migration." >&2; exit 1
}
printf 'Validated %d uniquely ordered migration files.\n' "${#files[@]}"
