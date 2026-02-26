#!/usr/bin/env bash
# OpenClaw — latência de resposta do gateway HTTP/WebSocket
# Por que importa para IA: alta latência = fila de inferência acumulando,
# timeouts de WebSocket no cliente, encadeamento de agentes atrasado

WARN_MS=1000; CRIT_MS=3000

START_NS=$(date +%s%N)
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
    --max-time 5 --connect-timeout 3 \
    http://127.0.0.1:18790/ 2>/dev/null) || HTTP_CODE="000"
END_NS=$(date +%s%N)

LATENCY_MS=$(( (END_NS - START_NS) / 1000000 ))

if [[ "$HTTP_CODE" == "000" ]]; then
    echo "CRITICAL - gateway not responding (timeout/refused) | latency=${CRIT_MS}ms;$WARN_MS;$CRIT_MS;0"
    exit 2
fi

if   (( LATENCY_MS >= CRIT_MS )); then EXIT=2; MSG="CRITICAL"
elif (( LATENCY_MS >= WARN_MS ));  then EXIT=1; MSG="WARNING"
else EXIT=0; MSG="OK"
fi

echo "$MSG - gateway http=$HTTP_CODE latency=${LATENCY_MS}ms | latency=${LATENCY_MS};$WARN_MS;$CRIT_MS;0"
exit $EXIT
