
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

# Check <path> <expected status> <expected substring in body>
check() {
  local path=$1
  local want=$2
  local needle=$3
  local body status

  for attempt in 1 2 3 4 5; do
    body=$(curl -sS --max-time 20 \
      "${headers[@]}" \
      -w $'\n%{http_code}' \
      "$base$path" || true)

    status=${body##*$'\n'}
    body=${body%$'\n'*}

    if [[ "$status" == "$want" && "$body" == *"$needle"* ]]; then
      echo "ok   $path -> $status"
      return 0
    fi

    sleep $((attempt * 3))
  done

  echo "FAIL $path -> $status (wanted $want containing '$needle')" >&2
  echo "Diagnostic response headers for $base$path:" >&2

  curl -sS --max-time 20 \
    -D - \
    -o /dev/null \
    "${headers[@]}" \
    "$base$path" >&2 || true

  echo "End diagnostic headers." >&2
  return 1
}

case "$target" in
  backend)
    check /api/health 200 '"ok":true'
    check /api/auth/session 401 '"unauthenticated"'
    ;;

  frontend)
    check / 200 'Every call'
    check /assets/media/aica-film.en.vtt 200 'WEBVTT'
    check /login 200 'Sign in · AICA'
    check /o/example 200 'Sign in · AICA'
    ;;

  *)
    echo "usage: smoke.sh <frontend|backend> <deployment-url>" >&2
    exit 2
    ;;
esac
