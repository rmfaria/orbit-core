#!/usr/bin/env python3
# orbit-core
#
# Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
# SPDX-License-Identifier: Apache-2.0

"""
Wazuh → orbit-core event shipper.

Reads Wazuh alerts from alerts.json (JSONL format) and ships them to
orbit-core via POST /api/v1/ingest/events.

Run as a cron job every minute (see cron.example).
"""
import os, json, fcntl
from datetime import datetime, timezone
import requests

ALERTS_FILE = os.environ.get("WAZUH_ALERTS_JSON", "/var/ossec/logs/alerts/alerts.json")
STATE_PATH  = os.environ.get("STATE_PATH", "/var/lib/orbit-core/wazuh-events.state.json")
MAX_BYTES_PER_RUN = int(os.environ.get("MAX_BYTES_PER_RUN", str(5 * 1024 * 1024)))  # 5 MB
BATCH_SIZE  = int(os.environ.get("BATCH_SIZE", "200"))

ORBIT_API = os.environ.get("ORBIT_API", "http://127.0.0.1:3000").rstrip("/")
ENDPOINT  = f"{ORBIT_API}/api/v1/ingest/events"

# Authentication — API key takes precedence over BasicAuth when both are set.
ORBIT_API_KEY    = os.environ.get("ORBIT_API_KEY")
# Optional BasicAuth (used when ORBIT_API_KEY is not set)
ORBIT_BASIC_USER = os.environ.get("ORBIT_BASIC_USER")
ORBIT_BASIC_PASS = os.environ.get("ORBIT_BASIC_PASS")
ORBIT_BASIC      = os.environ.get("ORBIT_BASIC")
ORBIT_BASIC_FILE = os.environ.get("ORBIT_BASIC_FILE")


def _load_basic_auth():
    user = ORBIT_BASIC_USER
    pwd  = ORBIT_BASIC_PASS

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


# Wazuh rule.level (0–15) → orbit severity
def _level_to_sev(level: int) -> str:
    if level <= 3:  return "info"
    if level <= 6:  return "low"
    if level <= 10: return "medium"
    if level <= 13: return "high"
    return "critical"


def load_state():
    if not os.path.exists(STATE_PATH):
        return {"offset": 0}
    try:
        with open(STATE_PATH, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                st = json.load(f)
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
        return {"offset": int(st.get("offset", 0))}
    except Exception:
        return {"offset": 0}


def save_state(st):
    os.makedirs(os.path.dirname(os.path.abspath(STATE_PATH)), exist_ok=True)
    with open(STATE_PATH, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            json.dump(st, f)
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def read_new_lines(path, offset):
    """Read new complete lines from file since byte offset.
    Detects file rotation: if file is smaller than offset, resets to 0."""
    if not os.path.exists(path):
        return [], offset

    size = os.path.getsize(path)

    # File was rotated (truncated or replaced) — restart from beginning
    if size < offset:
        offset = 0

    if offset >= size:
        return [], offset

    read_size = min(size - offset, MAX_BYTES_PER_RUN)

    with open(path, "rb") as f:
        f.seek(offset)
        data = f.read(read_size)

    # Only process complete lines — trim trailing partial line
    last_nl = data.rfind(b"\n")
    if last_nl == -1:
        return [], offset  # no complete line yet

    complete = data[:last_nl + 1]
    text  = complete.decode("utf-8", errors="replace")
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    return lines, offset + len(complete)


def alert_to_event(j: dict) -> dict | None:
    """Convert a Wazuh alert JSON object to an orbit-core Event."""
    rule  = j.get("rule") or {}
    agent = j.get("agent") or {}

    # agent.name preferred; fall back to agent.id
    agent_name = agent.get("name") or agent.get("id")
    if not agent_name:
        return None

    rule_id    = str(rule.get("id", ""))
    rule_level = int(rule.get("level", 0))
    rule_desc  = rule.get("description") or f"rule {rule_id}"
    groups     = rule.get("groups") or []
    kind       = groups[0] if groups else "alert"

    # Wazuh timestamps: "2024-02-23T14:00:00.000+0000" — convert to ISO with Z
    raw_ts = j.get("timestamp") or ""
    try:
        ts = datetime.fromisoformat(raw_ts.replace("+0000", "+00:00")).isoformat()
    except Exception:
        ts = datetime.now(timezone.utc).isoformat()

    # fingerprint: deduplicate repeated firings of the same rule on the same agent
    alert_id    = j.get("id") or raw_ts
    fingerprint = f"{agent.get('id', '')}:{rule_id}:{alert_id}"

    attributes = {
        "rule_id":    rule_id,
        "rule_level": rule_level,
        "rule_groups": groups,
        "agent_id":   agent.get("id"),
        "agent_name": agent.get("name"),
        "agent_ip":   agent.get("ip"),
        "manager":    (j.get("manager") or {}).get("name"),
        "decoder":    (j.get("decoder") or {}).get("name"),
        "location":   j.get("location"),
    }
    # Include extra data fields if present (srcip, etc.)
    if j.get("data"):
        attributes["data"] = j["data"]

    return {
        "ts":          ts,
        "asset_id":    f"host:{agent_name}",
        "namespace":   "wazuh",
        "kind":        kind,
        "severity":    _level_to_sev(rule_level),
        "title":       rule_desc,
        "message":     j.get("full_log") or "",
        "fingerprint": fingerprint,
        "attributes":  {k: v for k, v in attributes.items() if v is not None},
    }


def main():
    st = load_state()

    lines, st["offset"] = read_new_lines(ALERTS_FILE, st["offset"])
    if not lines:
        save_state(st)
        return

    events = []
    for ln in lines:
        try:
            j = json.loads(ln)
        except Exception:
            continue
        ev = alert_to_event(j)
        if ev:
            events.append(ev)

    if not events:
        save_state(st)
        return

    s = requests.Session()
    if ORBIT_API_KEY:
        s.headers["X-Api-Key"] = ORBIT_API_KEY
    else:
        basic = _load_basic_auth()
        if basic:
            s.auth = basic

    for i in range(0, len(events), BATCH_SIZE):
        batch = events[i : i + BATCH_SIZE]
        r = s.post(ENDPOINT, json={"events": batch}, timeout=25)
        if r.status_code not in (200, 201):
            raise SystemExit(f"orbit ingest events failed HTTP {r.status_code}: {r.text[:300]}")

    save_state(st)


if __name__ == "__main__":
    main()
