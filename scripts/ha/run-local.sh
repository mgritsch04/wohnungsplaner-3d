#!/usr/bin/env bash
# Smart Home 2a (#229): validates the planner's HA export with `check_config` (good export passes,
# broken one fails) and tests the bridge against a throw-away Home Assistant with `demo:`.
# Needs `hass` on PATH (pip install homeassistant). Used by .github/workflows/smart-home-ha.yml.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
hass_pid=""
cleanup() {
  if [ -n "$hass_pid" ]; then kill "$hass_pid" 2>/dev/null || true; wait "$hass_pid" 2>/dev/null || true; fi
  rm -rf "$work" || true
}
trap cleanup EXIT

node "$here/export-fixture.mjs" "$work/export"
for variant in good broken; do
  mkdir -p "$work/$variant"
  cp "$work/export/$variant/automations.yaml" "$work/$variant/automations.yaml"
  printf 'homeassistant:\n  name: CI\nautomation: !include automations.yaml\n' > "$work/$variant/configuration.yaml"
done

# check_config exits 0 even if automations are rejected (they are only disabled), so also look at its output
check() {
  local code=0
  hass --script check_config -c "$1" > "$1.log" 2>&1 || code=$?
  if grep -qE 'ERROR|Failed config|could not be validated' "$1.log"; then code=1; fi
  return $code
}
echo "== check_config: Export muss gültig sein"
check "$work/good" || { cat "$work/good.log"; echo "FAIL: check_config rejected the valid export"; exit 1; }
echo "== check_config: kaputter Export muss fehlschlagen"
if check "$work/broken"; then echo "FAIL: check_config accepted the broken export"; exit 1; fi
echo "OK: broken export rejected"

echo "== Bridge gegen Home Assistant mit demo:"
mkdir -p "$work/live"
printf 'homeassistant:\n  name: CI\n  latitude: 48.2\n  longitude: 16.4\n  elevation: 170\n  unit_system: metric\n  time_zone: Europe/Vienna\ndemo:\nhttp:\n  server_host: 127.0.0.1\n' > "$work/live/configuration.yaml"
hass -c "$work/live" > "$work/hass.log" 2>&1 &
hass_pid=$!
for _ in $(seq 1 180); do
  curl -fs http://127.0.0.1:8123/api/onboarding >/dev/null 2>&1 && break
  kill -0 "$hass_pid" 2>/dev/null || { cat "$work/hass.log"; echo "FAIL: hass exited"; exit 1; }
  sleep 1
done
node "$here/bridge-check.mjs" http://127.0.0.1:8123 || { tail -50 "$work/hass.log"; exit 1; }
