#!/usr/bin/env bash
# orbit-core — saúde da plataforma de observabilidade
# Por que importa: "monitorar o monitor" fecha o loop.
# Se orbit-core cair, toda visibilidade desaparece silenciosamente.

ORBIT_URL="https://prod.nesecurity.com.br/orbit-core/api/v1/health"
START_NS=$(date +%s%N)

RESPONSE=$(curl -sf --max-time 10 --connect-timeout 5 "$ORBIT_URL" 2>/dev/null)
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$ORBIT_URL" 2>/dev/null || echo "000")

END_NS=$(date +%s%N)
LATENCY_MS=$(( (END_NS - START_NS) / 1000000 ))

if [[ "$HTTP_CODE" == "000" ]]; then
    echo "CRITICAL - orbit-core unreachable (timeout/refused) | orbit_api_ok=0;1;1;0"
    exit 2
fi

if [[ "$HTTP_CODE" != "200" ]]; then
    echo "CRITICAL - orbit-core HTTP $HTTP_CODE | orbit_api_ok=0;1;1;0"
    exit 2
fi

DB_STATUS=$(echo "$RESPONSE" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('db','unknown'))" 2>/dev/null || echo "unknown")

WORKERS=$(echo "$RESPONSE" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(len(d.get('workers',[])))" 2>/dev/null || echo "0")

if [[ "$DB_STATUS" != "ok" ]]; then
    echo "CRITICAL - orbit-core db=$DB_STATUS | orbit_api_ok=0;1;1;0"
    exit 2
fi

echo "OK - orbit-core up db=$DB_STATUS workers=$WORKERS latency=${LATENCY_MS}ms | orbit_api_ok=1;1;1;0 orbit_latency_ms=$LATENCY_MS;500;2000;0 orbit_workers=$WORKERS;2;1;0"
exit 0
