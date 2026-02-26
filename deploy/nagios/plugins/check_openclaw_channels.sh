#!/usr/bin/env bash
# OpenClaw — saúde dos canais de IA (WhatsApp, Telegram, etc.)
# Por que importa para IA: canais reconectando ciclicamente = agente perde o canal,
# usuários ficam sem resposta, filas de mensagem acumulam sem entrega

WARN_ERRORS=3; CRIT_ERRORS=10
WARN_QR=2     # reconexões WhatsApp (cada QR = sessão reiniciada)

# Erros de canal nos últimos 10 minutos
ERRORS=$(journalctl -u openclaw-dbarcellos --since "10 minutes ago" \
    --no-pager -q 2>/dev/null | \
    grep -cE "UNAVAILABLE|No active.*listener|message failed|errorCode=" || true)

# Reconexões WhatsApp (QR gerado = sessão WA resetada)
QR_EVENTS=$(journalctl -u openclaw-dbarcellos --since "10 minutes ago" \
    --no-pager -q 2>/dev/null | \
    grep -c "QR received" || true)

# Inferências com falha
TOOL_FAILURES=$(journalctl -u openclaw-dbarcellos --since "10 minutes ago" \
    --no-pager -q 2>/dev/null | \
    grep -c "message failed:" || true)

if   (( ERRORS >= CRIT_ERRORS )); then EXIT=2; MSG="CRITICAL"
elif (( ERRORS >= WARN_ERRORS ));  then EXIT=1; MSG="WARNING"
elif (( QR_EVENTS >= WARN_QR ));   then EXIT=1; MSG="WARNING - WhatsApp reconnect loop"
else EXIT=0; MSG="OK"
fi

echo "$MSG - channel_errors=${ERRORS}/10m qr_reconnects=$QR_EVENTS tool_failures=$TOOL_FAILURES | channel_errors=$ERRORS;$WARN_ERRORS;$CRIT_ERRORS;0 qr_reconnects=$QR_EVENTS;$WARN_QR;5;0 tool_failures=$TOOL_FAILURES;;;0"
exit $EXIT
