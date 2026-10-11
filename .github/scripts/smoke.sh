#!/usr/bin/env bash
# Post-deploy smoke test: smoke.sh <frontend|backend> <deployment-url>
# Set VERCEL_AUTOMATION_BYPASS_SECRET when Vercel Deployment Protection is on.
set -euo pipefail

target=$1
base="${2%/}"
headers=()
if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
  headers=(-H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET")
fi

# check <path> <expected status> <expected substring in body>
check() {
  local path=$1 want=$2 needle=$3 body status
  for attempt in 1 2 3 4 5; do
    body=$(curl -sS --max-time 20 "${headers[@]}" -w $'\n%{http_code}' "$base$path" || true)
    status=${body##*$'\n'}
    body=${body%$'\n'*}
    if [[ "$status" == "$want" && "$body" == *"$needle"* ]]; then
      echo "ok   $path -> $status"
      return 0
    fi
    sleep $((attempt * 3))  # cold starts
  done
  echo "FAIL $path -> $status (wanted $want containing '$needle')" >&2
  return 1
}

case "$target" in
  backend)
    check /api/health 200 '"ok":true'
    check /api/auth/session 401 '"unauthenticated"'
    ;;
  frontend)
    check / 200 'Every call'                           # the landing page, prerendered (index.html)
    check /assets/media/aica-film.en.vtt 200 'WEBVTT'  # its fixed-name media
    check /login 200 'Sign in · AICA'                  # the console shell (app.html)
    check /o/example 200 'Sign in · AICA'              # console fallback
    ;;
  *)
    echo "usage: smoke.sh <frontend|backend> <deployment-url>" >&2
    exit 2
    ;;
esac
