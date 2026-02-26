#!/usr/bin/env bash
# OpenClaw — estabilidade via systemd
# Monitora: estado active/failed, contagem de restarts, uptime desde último restart
# Por que importa para IA: restarts frequentes = sessões perdidas, contextos descartados

SERVICE="openclaw-dbarcellos"
WARN_RESTARTS=3; CRIT_RESTARTS=10
WARN_UPTIME_MIN=10  # alerta se reiniciou há menos de 10 minutos

STATE=$(systemctl is-active "$SERVICE" 2>/dev/null)
if [[ "$STATE" != "active" ]]; then
    SUBSTATUS=$(systemctl show "$SERVICE" --property=SubState --value 2>/dev/null || echo "unknown")
    echo "CRITICAL - $SERVICE is $STATE/$SUBSTATUS (not active)"
    exit 2
fi

NRESTARTS=$(systemctl show "$SERVICE" --property=NRestarts --value 2>/dev/null || echo 0)

# Calcula uptime: diferença entre agora e ActiveEnterTimestamp
ACTIVE_TS=$(systemctl show "$SERVICE" --property=ActiveEnterTimestamp --value 2>/dev/null || echo "")
if [[ -n "$ACTIVE_TS" ]]; then
    ACTIVE_EPOCH=$(date -d "$ACTIVE_TS" +%s 2>/dev/null || echo 0)
    NOW_EPOCH=$(date +%s)
    UPTIME_SEC=$((NOW_EPOCH - ACTIVE_EPOCH))
    UPTIME_MIN=$((UPTIME_SEC / 60))
else
    UPTIME_MIN=9999
fi

UPTIME_H=$((UPTIME_MIN / 60))
UPTIME_LABEL="${UPTIME_MIN}min"
if (( UPTIME_MIN >= 120 )); then UPTIME_LABEL="${UPTIME_H}h"; fi

if   (( NRESTARTS >= CRIT_RESTARTS )); then EXIT=2; MSG="CRITICAL"
elif (( NRESTARTS >= WARN_RESTARTS ));  then EXIT=1; MSG="WARNING"
elif (( UPTIME_MIN < WARN_UPTIME_MIN )); then EXIT=1; MSG="WARNING - recently restarted"
else EXIT=0; MSG="OK"
fi

echo "$MSG - state=active restarts=$NRESTARTS uptime=$UPTIME_LABEL | restarts=$NRESTARTS;$WARN_RESTARTS;$CRIT_RESTARTS;0 uptime_min=$UPTIME_MIN;$WARN_UPTIME_MIN;;0"
exit $EXIT
