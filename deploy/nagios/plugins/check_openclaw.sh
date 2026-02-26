#!/usr/bin/env bash
# OpenClaw Gateway — disponibilidade + memória específica do processo
# Substitui o check anterior que somava TODOS os processos node (incorreto)

WARN_MEM=600; CRIT_MEM=900  # MB

PID=$(pgrep -f "openclaw-gateway" | head -1)
if [[ -z "$PID" ]]; then
    echo "CRITICAL - openclaw-gateway process not found"
    exit 2
fi

RSS_KB=$(awk '/VmRSS/{print $2}' /proc/$PID/status 2>/dev/null || echo 0)
RSS_MB=$((RSS_KB / 1024))

if ! timeout 3 bash -c "echo > /dev/tcp/127.0.0.1/18790" 2>/dev/null; then
    echo "CRITICAL - port 18790 not reachable (pid=$PID, mem=${RSS_MB}MB)"
    exit 2
fi

THREADS=$(awk '/Threads/{print $2}' /proc/$PID/status 2>/dev/null || echo "?")

if   (( RSS_MB >= CRIT_MEM )); then S=2; M="CRITICAL"
elif (( RSS_MB >= WARN_MEM )); then S=1; M="WARNING"
else                                 S=0; M="OK"
fi

echo "$M - gateway pid=$PID mem=${RSS_MB}MB threads=$THREADS port=18790 UP | mem=${RSS_MB};$WARN_MEM;$CRIT_MEM;0"
exit $S
