#!/usr/bin/env bash
# OpenClaw — monitoramento de file descriptors (detecção de leak)
# Por que importa para IA: gateways de IA mantêm WebSockets de longa duração.
# Crescimento anormal de FDs indica leak de conexão → eventual crash com EMFILE.

WARN_FD=200; CRIT_FD=500

PID=$(pgrep -f "openclaw-gateway" | head -1)
if [[ -z "$PID" ]]; then
    echo "CRITICAL - openclaw-gateway process not found"
    exit 2
fi

FD_COUNT=$(ls /proc/$PID/fd 2>/dev/null | wc -l)
if [[ -z "$FD_COUNT" ]]; then
    echo "UNKNOWN - cannot read /proc/$PID/fd"
    exit 3
fi

# FD limit do processo
FD_LIMIT=$(cat /proc/$PID/limits 2>/dev/null | awk '/open files/{print $4}' | head -1 || echo "1024")
FD_PCT=0
if [[ "$FD_LIMIT" =~ ^[0-9]+$ && "$FD_LIMIT" -gt 0 ]]; then
    FD_PCT=$(( FD_COUNT * 100 / FD_LIMIT ))
fi

if   (( FD_COUNT >= CRIT_FD )); then EXIT=2; MSG="CRITICAL"
elif (( FD_COUNT >= WARN_FD ));  then EXIT=1; MSG="WARNING"
elif (( FD_PCT  >= 80 ));        then EXIT=1; MSG="WARNING - FD limit approaching"
else EXIT=0; MSG="OK"
fi

echo "$MSG - pid=$PID open_fds=$FD_COUNT limit=$FD_LIMIT usage=${FD_PCT}% | open_fds=$FD_COUNT;$WARN_FD;$CRIT_FD;0;$FD_LIMIT fd_pct=$FD_PCT;70;90;0;100"
exit $EXIT
