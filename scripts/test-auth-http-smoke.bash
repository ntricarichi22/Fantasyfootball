#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$root/scripts/lib/with-local-app.bash" "$root/scripts/test-auth-http-smoke.mjs"
