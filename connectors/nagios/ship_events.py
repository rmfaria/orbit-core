#!/usr/bin/env python3
import os, json
from datetime import datetime, timezone
import requests

SPOOL = os.environ.get("NAGIOS_HARD_EVENTS_JSONL", "/var/log/nagios4/neb-hard-events.jsonl")
STATE_PATH = os.environ.get("STATE_PATH", "/var/lib/orbit-core/nagios-events.state.json")
MAX_PER_RUN = int(os.environ.get("MAX_PER_RUN", "400"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "200"))

ORBIT_API = os.environ.get("ORBIT_API", "http://127.0.0.1:3000").rstrip("/")
ENDPOINT = f"{ORBIT_API}/api/v1/ingest/events"

# Optional BasicAuth
ORBIT_BASIC_USER = os.environ.get("ORBIT_BASIC_USER")
ORBIT_BASIC_PASS = os.environ.get("ORBIT_BASIC_PASS")
ORBIT_BASIC = os.environ.get("ORBIT_BASIC")
ORBIT_BASIC_FILE = os.environ.get("ORBIT_BASIC_FILE")


def _load_basic_auth():
    user = ORBIT_BASIC_USER
    pwd = ORBIT_BASIC_PASS

    if ORBIT_BASIC and ":" in ORBIT_BASIC:
        user, pwd = ORBIT_BASIC.split(":", 1)

    if ORBIT_BASIC_FILE and os.path.exists(ORBIT_BASIC_FILE) and user and not pwd:
        try:
            pwd = open(ORBIT_BASIC_FILE, "r").read().strip()
        except Exception:
            pwd = None

    if user and pwd:
        return (user, pwd)
    return None


def load_state():
    if not os.path.exists(STATE_PATH):
        return {"lastLine": 0}
    try:
        return json.load(open(STATE_PATH, "r"))
    except Exception:
        return {"lastLine": 0}


def save_state(st):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    json.dump(st, open(STATE_PATH, "w"))


def sev(kind, state):
    # map Nagios states to Orbit severities
    if kind == "host":
        return "info" if state == 0 else ("high" if state == 1 else ("critical" if state == 2 else "medium"))
    return "info" if state == 0 else ("medium" if state == 1 else ("critical" if state == 2 else "high"))


def main():
    if not os.path.exists(SPOOL):
        return

    st = load_state()
    last = int(st.get("lastLine", 0) or 0)

    with open(SPOOL, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()

    total = len(lines)
    if last >= total:
        return

    new = lines[last : last + MAX_PER_RUN]
    events = []
    for ln in new:
        ln = ln.strip()
        if not ln:
            continue
        try:
            j = json.loads(ln)
        except Exception:
            continue

        kind = j.get("kind")
        host = j.get("host")
        state = int(j.get("state", 3))
        service = j.get("service")
        ts = j.get("ts") or datetime.now(timezone.utc).isoformat()
        title = f"{host} HOST state={state}" if kind == "host" else f"{host} {service or '?'} state={state}"

        events.append(
            {
                "ts": ts,
                "asset_id": f"host:{host}",
                "namespace": "nagios",
                "kind": "state_change",
                "severity": sev(kind, state),
                "title": title,
                "message": j.get("output") or "",
                "fingerprint": f"{kind}:{host}:{service or ''}",
                "attributes": j,
            }
        )

    s = requests.Session()
    basic = _load_basic_auth()
    if basic:
        s.auth = basic

    for i in range(0, len(events), BATCH_SIZE):
        batch = events[i : i + BATCH_SIZE]
        r = s.post(ENDPOINT, json={"events": batch}, timeout=25)
        if r.status_code not in (200, 201):
            raise SystemExit(f"orbit ingest events failed HTTP {r.status_code}: {r.text[:300]}")

    st["lastLine"] = last + len(new)
    save_state(st)


if __name__ == "__main__":
    main()
