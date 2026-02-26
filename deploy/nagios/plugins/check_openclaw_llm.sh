#!/usr/bin/env bash
# OpenClaw — alcançabilidade da API de LLM upstream (Anthropic)
# Por que importa para IA: se o provider estiver inacessível, o gateway aceita
# conexões mas TODAS as inferências falham silenciosamente.
# Distingue "bug local" de "provider indisponível" — ação corretiva diferente.

LLM_HOST="api.anthropic.com"
LLM_PORT=443
WARN_MS=500; CRIT_MS=2000

START_NS=$(date +%s%N)
if ! timeout 5 bash -c "echo > /dev/tcp/${LLM_HOST}/${LLM_PORT}" 2>/dev/null; then
    echo "CRITICAL - ${LLM_HOST}:${LLM_PORT} unreachable | llm_upstream_ms=${CRIT_MS};$WARN_MS;$CRIT_MS;0"
    exit 2
fi
END_NS=$(date +%s%N)
LATENCY_MS=$(( (END_NS - START_NS) / 1000000 ))

if   (( LATENCY_MS >= CRIT_MS )); then EXIT=2; MSG="CRITICAL"
elif (( LATENCY_MS >= WARN_MS ));  then EXIT=1; MSG="WARNING"
else EXIT=0; MSG="OK"
fi

echo "$MSG - ${LLM_HOST}:${LLM_PORT} reachable latency=${LATENCY_MS}ms | llm_upstream_ms=$LATENCY_MS;$WARN_MS;$CRIT_MS;0"
exit $EXIT
