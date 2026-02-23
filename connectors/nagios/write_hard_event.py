#!/usr/bin/env python3
"""
Nagios global event handler — appends HARD state changes to a JSONL spool.

This script replaces the need for a NEB broker module. Configure it as a
global event handler in nagios.cfg + commands.cfg (see INSTALL.md step 3).

Usage (called by Nagios):
  write_hard_event.py <kind> <host> <service> <state_str> <state_type> <attempt> <output> [epoch]

Arguments:
  kind        "host" or "service"
  host        $HOSTNAME$
  service     $SERVICEDESC$ (empty string for host checks)
  state_str   $SERVICESTATE$ or $HOSTSTATE$
  state_type  $SERVICESTATETYPE$ or $HOSTSTATETYPE$
  attempt     $SERVICEATTEMPT$ or $HOSTATTEMPT$
  output      $SERVICEOUTPUT$ or $HOSTOUTPUT$
  epoch       $LASTSERVICECHECK$ or $LASTHOSTCHECK$ (optional)
"""
import sys, json, os
from datetime import datetime, timezone

SPOOL = os.environ.get("ORBIT_EVENTS_SPOOL", "/var/log/nagios4/neb-hard-events.jsonl")

# Map Nagios string states to numeric codes used by ship_events.py
_STATE_HOST = {"UP": 0, "DOWN": 1, "UNREACHABLE": 2}
_STATE_SVC  = {"OK": 0, "WARNING": 1, "CRITICAL": 2, "UNKNOWN": 3}


def main():
    if len(sys.argv) < 7:
        return

    kind       = sys.argv[1]
    host       = sys.argv[2]
    service    = sys.argv[3] if sys.argv[3] else None
    state_str  = sys.argv[4].upper()
    state_type = sys.argv[5].upper()
    attempt    = int(sys.argv[6]) if sys.argv[6].isdigit() else 1
    output     = sys.argv[7] if len(sys.argv) > 7 else ""
    epoch      = sys.argv[8] if len(sys.argv) > 8 else ""

    # Only write HARD state changes
    if state_type != "HARD":
        return

    smap  = _STATE_HOST if kind == "host" else _STATE_SVC
    state = smap.get(state_str, 3)

    try:
        ts = datetime.fromtimestamp(int(epoch), tz=timezone.utc).isoformat()
    except Exception:
        ts = datetime.now(timezone.utc).isoformat()

    entry = {
        "kind":       kind,
        "ts":         ts,
        "host":       host,
        "service":    service,
        "state":      state,
        "state_str":  state_str,
        "state_type": state_type,
        "attempt":    attempt,
        "output":     output,
    }

    spool_dir = os.path.dirname(SPOOL)
    if spool_dir:
        os.makedirs(spool_dir, exist_ok=True)

    with open(SPOOL, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


if __name__ == "__main__":
    main()
