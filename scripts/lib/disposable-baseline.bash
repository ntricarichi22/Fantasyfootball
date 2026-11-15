#!/usr/bin/env bash
# Shared clean schema bootstrap; callers own their disposable stack lifecycle.
stage_ci_baseline() {
  local task_root="$1"
  ci_baseline_path="$task_root/supabase/migrations/000_ci_pre001_clean_database.sql"
  if [[ -e "$ci_baseline_path" ]]; then
    cmp -s "$task_root/supabase/baseline/pre001_clean_database.sql" "$ci_baseline_path" || { echo "CI baseline differs from reviewed source." >&2; return 1; }
  else
    cp "$task_root/supabase/baseline/pre001_clean_database.sql" "$ci_baseline_path"
  fi
}
cleanup_ci_baseline() { [[ -z "${ci_baseline_path:-}" ]] || rm -f "$ci_baseline_path"; }
