#!/usr/bin/env bash
# OpenClaw — integridade do workspace persistente
# Por que importa para IA: armazena sessões de conversa, estado de agentes,
# histórico de contexto. Disco cheio ou perda de permissão = todos os agentes
# perdem memória persistente imediatamente.

WORKSPACE="/home/openclaw-dbarcellos"
WARN_MB=500; CRIT_MB=200

if [[ ! -d "$WORKSPACE" ]]; then
    echo "CRITICAL - workspace directory $WORKSPACE does not exist"
    exit 2
fi

AVAIL_MB=$(df -m "$WORKSPACE" --output=avail 2>/dev/null | tail -1 | tr -d ' ')
if [[ -z "$AVAIL_MB" || ! "$AVAIL_MB" =~ ^[0-9]+$ ]]; then
    echo "UNKNOWN - cannot stat disk for $WORKSPACE"
    exit 3
fi

# Writability test (runs as nagios user — may fail due to permissions, treat as warning)
WRITABLE="yes"
TEST_FILE="$WORKSPACE/.nagios_write_test_$$"
if ! touch "$TEST_FILE" 2>/dev/null; then
    WRITABLE="no (nagios user cannot write — check permissions)"
fi
rm -f "$TEST_FILE" 2>/dev/null

# State files count (proxy for session activity)
STATE_FILES=$(find "$WORKSPACE" -maxdepth 3 \( -name "*.sqlite" -o -name "*.db" -o -name "*.json" \) 2>/dev/null | wc -l)

EXIT=0; MSG="OK"
if [[ "$WRITABLE" == no* ]]; then EXIT=1; MSG="WARNING"; fi
if   (( AVAIL_MB <= CRIT_MB )); then EXIT=2; MSG="CRITICAL"
elif (( AVAIL_MB <= WARN_MB )); then
    if (( EXIT < 1 )); then EXIT=1; MSG="WARNING"; fi
fi

echo "$MSG - workspace=${WORKSPACE} disk_free=${AVAIL_MB}MB writable=$WRITABLE state_files=$STATE_FILES | disk_free_mb=$AVAIL_MB;$WARN_MB;$CRIT_MB;0 state_files=$STATE_FILES;;;0"
exit $EXIT
