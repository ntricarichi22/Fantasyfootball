#!/usr/bin/env bash
set -euo pipefail

mapfile -t files < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort)
(( ${#files[@]} > 0 )) || { echo "No Supabase migrations found." >&2; exit 1; }

declare -A versions=()
previous=""
for file in "${files[@]}"; do
  if [[ ! "$file" =~ ^([0-9]+)_[a-z0-9_]+\.sql$ ]]; then
    echo "Invalid migration filename: $file" >&2
    exit 1
  fi
  version="${BASH_REMATCH[1]}"
  if [[ -n "${versions[$version]:-}" ]]; then
    echo "Duplicate migration version $version: ${versions[$version]} and $file" >&2
    exit 1
  fi
  versions[$version]="$file"
  if [[ -n "$previous" && "$version" < "$previous" ]]; then
    echo "Migration versions do not sort in execution order: $previous then $version" >&2
    exit 1
  fi
  previous="$version"
  [[ -s "supabase/migrations/$file" ]] || { echo "Empty migration: $file" >&2; exit 1; }
done

if rg -n '^(<<<<<<<|=======|>>>>>>>)' supabase/migrations; then
  echo "Merge-conflict marker found in migrations." >&2
  exit 1
fi

printf 'Validated %d uniquely ordered migration files.\n' "${#files[@]}"
