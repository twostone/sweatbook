#!/usr/bin/env bash
# Smoke test of the app image, called by the shared CI (twostone/hassio-workflows app-ci.yml).
# Usage: scripts/smoke.sh <image>
set -euo pipefail
IMAGE="${1:?usage: $0 <image>}"

dump() { echo "--- container log ($1)"; docker logs "$1" || true; }
user='X-Remote-User-Id: smoke'

# 1) Ingress guard switched off: frontend and API are served and SQLite works inside the image.
docker run -d --name smoke -p 8099:8099 -e INGRESS_ONLY_IP= "$IMAGE"
for _ in $(seq 1 30); do
  curl -fsS -H "$user" http://localhost:8099/api/sessions >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS -H "$user" http://localhost:8099/api/sessions | grep -q '^\[\]$' || { dump smoke; exit 1; }
curl -fsS http://localhost:8099/ | grep -q '<title>Sweatbook</title>' || { dump smoke; exit 1; }
curl -fsS -X POST -H "$user" -H 'Content-Type: application/json' http://localhost:8099/api/sessions \
  -d '{"started_at":"2026-10-24T10:00:00Z"}' | grep -q '"started_at":"2026-10-24T10:00:00.000Z"' || { dump smoke; exit 1; }
# without the ingress user header there is no data
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8099/api/sessions)" = "401" ] || { dump smoke; exit 1; }
docker rm -f smoke

# 2) Default configuration: only Supervisor's ingress address may connect, everyone else gets 403.
docker run -d --name guarded -p 8100:8099 "$IMAGE"
code=000
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "$user" http://localhost:8100/api/sessions || true)
  [ "$code" != "000" ] && break
  sleep 1
done
[ "$code" = "403" ] || { echo "expected 403 from the ingress guard, got $code"; dump guarded; exit 1; }
docker rm -f guarded

# 3) MCP with OAuth through Home Assistant (URLs from the environment): the metadata is public past the ingress guard,
# /mcp without a token answers 401 with a challenge that points to it. The options file switches MCP on.
printf '{"mcp_enabled":true}' > /tmp/smoke-options.json
docker run -d --name oauth -p 8101:8099 -v /tmp/smoke-options.json:/opts.json:ro -e OPTIONS_PATH=/opts.json \
  -e APP_EXTERNAL_URL=https://sweatbook.example.test -e HA_EXTERNAL_URL=https://ha.example.test "$IMAGE"
meta=http://localhost:8101/.well-known/oauth-protected-resource/mcp
for _ in $(seq 1 30); do
  curl -fsS "$meta" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "$meta" | grep -q '"authorization_servers":\["https://ha.example.test"\]' || { dump oauth; exit 1; }
challenge=$(curl -s -o /dev/null -D - -X POST http://localhost:8101/mcp | tr -d '\r' | grep -i '^www-authenticate:' || true)
echo "$challenge" | grep -q 'resource_metadata="https://sweatbook.example.test/.well-known/oauth-protected-resource/mcp"' \
  || { echo "unexpected challenge: $challenge"; dump oauth; exit 1; }
docker rm -f oauth

# Shutdown: SIGTERM (what `ha apps stop` sends) must end the app cleanly with exit code 0 within the Supervisor's
# 10 s timeout. Otherwise the Supervisor shows the app as "error" instead of "stopped".
docker run -d --name stopping -p 8099:8099 -e INGRESS_ONLY_IP= "$IMAGE"
for _ in $(seq 1 30); do
  curl -fsS -H 'X-Remote-User-Id: smoke' http://localhost:8099/api/sessions >/dev/null 2>&1 && break
  sleep 1
done
start=$(date +%s)
docker stop -t 10 stopping >/dev/null
elapsed=$(( $(date +%s) - start ))
exit_code=$(docker inspect -f '{{.State.ExitCode}}' stopping)
[ "$exit_code" = "0" ] || { echo "expected exit code 0 after SIGTERM, got $exit_code"; dump stopping; exit 1; }
[ "$elapsed" -lt 9 ] || { echo "stop took ${elapsed}s (limit 10 s)"; dump stopping; exit 1; }
docker rm -f stopping
