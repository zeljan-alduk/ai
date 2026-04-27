#!/usr/bin/env bash
# Seed the live API with test data so the web UI has something to show.
# Usage:
#   API=https://ai.aldo.tech EMAIL=admin@aldo.tech PASS='...' bash scripts/seed-test-data.sh
set -euo pipefail
API="${API:-https://ai.aldo.tech}"
EMAIL="${EMAIL:?EMAIL required}"
PASS="${PASS:?PASS required}"

echo "==> login $EMAIL"
TOK=$(curl -sS --fail -X POST -H 'content-type: application/json' \
  "$API/v1/auth/login" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
echo "    token: ${TOK:0:24}..."

H=( -H "Authorization: Bearer $TOK" -H 'content-type: application/json' )

echo "==> seed 26 agency agents"
curl -sS --fail -X POST "${H[@]}" "$API/v1/tenants/me/seed-default" >/dev/null
echo "    OK"

echo "==> create 3 saved views on /runs"
for q in '{"name":"Failed runs","surface":"runs","query":{"status":["failed"]},"isShared":true}' \
         '{"name":"Last 24h","surface":"runs","query":{"started_after":"P1D"},"isShared":false}' \
         '{"name":"My agent runs","surface":"runs","query":{"agent":["architect"]},"isShared":false}'; do
  curl -sS --fail -X POST "${H[@]}" "$API/v1/views" -d "$q" >/dev/null
done
echo "    OK"

echo "==> create 1 webhook integration (no real URL)"
curl -sS --fail -X POST "${H[@]}" "$API/v1/integrations" -d '{
  "kind":"webhook","name":"Demo webhook",
  "config":{"webhookUrl":"https://example.com/hooks/demo","signingSecret":"demo-secret"},
  "events":["run_completed","run_failed","guards_blocked"],
  "enabled":true
}' >/dev/null && echo "    OK"

echo "==> create 1 alert rule (cost spike)"
curl -sS --fail -X POST "${H[@]}" "$API/v1/alerts" -d '{
  "name":"Cost > $1/hour","kind":"cost_spike",
  "threshold":{"value":1.0,"comparator":"gt","period":"1h"},
  "targets":{},"notificationChannels":["app"],"enabled":true
}' >/dev/null && echo "    OK"

echo "==> create 1 API key (scopes: runs:read,agents:read)"
KEYRES=$(curl -sS --fail -X POST "${H[@]}" "$API/v1/api-keys" -d '{
  "name":"Demo read-only key","scopes":["runs:read","agents:read"]
}')
echo "$KEYRES" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('    key (shown ONCE):', d.get('key','?')[:36]+'...')"

echo "==> seed 3 annotations on a placeholder run id"
RUN_ID="seed-demo-run-$(date +%s)"
for body in '"Initial review — looks good, ship it."' \
            '"Followup: model swap on step 3 saved 40%."' \
            '"Closing this out, archiving."'; do
  curl -sS --fail -X POST "${H[@]}" "$API/v1/annotations" -d "{
    \"targetKind\":\"run\",\"targetId\":\"$RUN_ID\",\"body\":$body
  }" >/dev/null
done
echo "    OK ($RUN_ID)"

echo "==> create 1 dashboard with 3 widgets"
curl -sS --fail -X POST "${H[@]}" "$API/v1/dashboards" -d '{
  "name":"Demo dashboard","description":"Auto-seeded demo",
  "isShared":true,
  "layout":[
    {"kind":"kpi-runs-24h","title":"Runs 24h","query":{},"layout":{"col":0,"row":0,"w":4,"h":2}},
    {"kind":"kpi-cost-mtd","title":"Cost MTD","query":{},"layout":{"col":4,"row":0,"w":4,"h":2}},
    {"kind":"timeseries-cost","title":"Cost trend","query":{"period":"7d"},"layout":{"col":0,"row":2,"w":8,"h":4}}
  ]
}' >/dev/null && echo "    OK"

echo
echo "✓ seed complete — refresh the web UI"
