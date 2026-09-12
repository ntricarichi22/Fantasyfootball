#!/usr/bin/env bash
set -euo pipefail
required=(PRODUCTION_PROJECT_REF RECOVERY_TARGET_PROJECT_REF RECOVERY_TARGET_APPROVAL
  RECOVERY_TARGET_DELETE_AFTER RECOVERY_SIDE_EFFECTS_DISABLED RECOVERY_STORAGE_PLAN_CONFIRMED)
for name in "${required[@]}"; do [[ -n "${!name:-}" ]] || { echo "Missing drill prerequisite: $name" >&2; exit 1; }; done
[[ $PRODUCTION_PROJECT_REF == owkxkpkdffhcordlxqte ]] || { echo "Production reference is not the reviewed source." >&2; exit 1; }
[[ $RECOVERY_TARGET_PROJECT_REF != "$PRODUCTION_PROJECT_REF" ]] || { echo "Recovery target equals production." >&2; exit 1; }
IFS=',' read -ra protected <<< "${RECOVERY_PROTECTED_PROJECT_REFS:-$PRODUCTION_PROJECT_REF}"
for ref in "${protected[@]}"; do [[ $RECOVERY_TARGET_PROJECT_REF != "$ref" ]] || { echo "Recovery target is in the protected-project denylist." >&2; exit 1; }; done
[[ $RECOVERY_SIDE_EFFECTS_DISABLED == YES && $RECOVERY_STORAGE_PLAN_CONFIRMED == YES ]] || { echo "Target side effects or Storage handling are not confirmed." >&2; exit 1; }
expiry=$(date -u -d "$RECOVERY_TARGET_DELETE_AFTER" +%s) || { echo "Invalid cleanup timestamp." >&2; exit 1; }
now=$(date -u +%s); (( expiry > now && expiry <= now + 604800 )) || { echo "Cleanup must be scheduled within seven days." >&2; exit 1; }
[[ ${#RECOVERY_TARGET_APPROVAL} -ge 3 ]] || { echo "A recorded target approval reference is required." >&2; exit 1; }
echo "Restore-drill target declaration passed; this check does not provision or restore anything."
