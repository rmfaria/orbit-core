#!/usr/bin/env python3
# orbit-core
#
# Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
# SPDX-License-Identifier: Apache-2.0

"""
Suricata → orbit-core event shipper.

Reads Suricata EVE-JSON logs and ships security events to
orbit-core via POST /api/v1/ingest/events.

Supported event types: alert, anomaly, http, ssh (default).
Optional: dns, tls (high volume — enable via SURICATA_EVENT_TYPES).

Run as a cron job every minute (see cron.example).
"""
import os, json, fcntl, sys
from datetime import datetime, timezone
import requests

EVE_FILE   = os.environ.get("SURICATA_EVE_JSON", "/var/log/suricata/eve.json")
STATE_PATH = os.environ.get("STATE_PATH", "/var/lib/orbit-core/suricata-events.state.json")
MAX_BYTES_PER_RUN = int(os.environ.get("MAX_BYTES_PER_RUN", str(5 * 1024 * 1024)))  # 5 MB
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "200"))

ORBIT_API = os.environ.get("ORBIT_API", "http://127.0.0.1:3000").rstrip("/")
ENDPOINT  = f"{ORBIT_API}/api/v1/ingest/events"

# Configurable event types to ingest
DEFAULT_TYPES = "alert,anomaly,http,ssh"
EVENT_TYPES   = set(os.environ.get("SURICATA_EVENT_TYPES", DEFAULT_TYPES).split(","))

# Sensor name used as fallback asset_id when src_ip is missing
SENSOR_NAME = os.environ.get("SURICATA_SENSOR", "sensor:suricata")

# Authentication — API key takes precedence over BasicAuth when both are set.
ORBIT_API_KEY    = os.environ.get("ORBIT_API_KEY")
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


# ── Severity mapping ────────────────────────────────────────────────

# Suricata alert.severity: 1=high, 2=medium, 3=low (inverted scale)
_ALERT_SEV = {1: "critical", 2: "high", 3: "medium", 4: "low"}

# Non-alert event types get a fixed severity
_TYPE_SEV = {
    "anomaly": "medium",
    "dns":     "info",
    "http":    "info",
    "tls":     "info",
    "ssh":     "info",
}


def _severity(event_type, alert_sev=None):
    if event_type == "alert" and alert_sev is not None:
        return _ALERT_SEV.get(int(alert_sev), "medium")
    return _TYPE_SEV.get(event_type, "info")


# ── Title builder ───────────────────────────────────────────────────

def _title(j, event_type):
    if event_type == "alert":
        alert = j.get("alert") or {}
        return alert.get("signature") or f"Alert SID {alert.get('signature_id', '?')}"

    if event_type == "dns":
        dns = j.get("dns") or {}
        rrname = dns.get("rrname") or dns.get("rdata") or "?"
        qtype  = dns.get("rrtype") or dns.get("type") or ""
        return f"DNS {qtype} {rrname}"

    if event_type == "http":
        http = j.get("http") or {}
        method   = http.get("http_method") or "?"
        hostname = http.get("hostname") or j.get("dest_ip") or "?"
        url      = http.get("url") or "/"
        return f"HTTP {method} {hostname}{url}"[:90]

    if event_type == "tls":
        tls = j.get("tls") or {}
        ver = tls.get("version") or "?"
        sni = tls.get("sni") or j.get("dest_ip") or "?"
        return f"TLS {ver} {sni}"

    if event_type == "ssh":
        ssh = j.get("ssh") or {}
        client = (ssh.get("client") or {}).get("software_version") or "?"
        server = (ssh.get("server") or {}).get("software_version") or "?"
        return f"SSH client={client} server={server}"

    if event_type == "anomaly":
        anom = j.get("anomaly") or {}
        return f"Anomaly: {anom.get('event') or anom.get('type') or '?'}"

    return f"Suricata {event_type}"


# ── Attributes extractor ───────────────────────────────────────────

def _attributes(j, event_type):
    attrs = {}

    # Common network fields
    for k in ("src_ip", "src_port", "dest_ip", "dest_port", "proto", "app_proto", "flow_id"):
        if j.get(k) is not None:
            attrs[k] = j[k]

    # Type-specific fields
    if event_type == "alert":
        alert = j.get("alert") or {}
        attrs["signature_id"] = alert.get("signature_id")
        attrs["signature"]    = alert.get("signature")
        attrs["category"]     = alert.get("category")
        attrs["action"]       = alert.get("action")
        attrs["rev"]          = alert.get("rev")
        attrs["gid"]          = alert.get("gid")

    elif event_type == "dns":
        dns = j.get("dns") or {}
        attrs["rrname"] = dns.get("rrname")
        attrs["rrtype"] = dns.get("rrtype")
        attrs["rcode"]  = dns.get("rcode")
        attrs["rdata"]  = dns.get("rdata")
        attrs["dns_type"] = dns.get("type")

    elif event_type == "http":
        http = j.get("http") or {}
        attrs["http_method"]      = http.get("http_method")
        attrs["hostname"]         = http.get("hostname")
        attrs["url"]              = http.get("url")
        attrs["status"]           = http.get("status")
        attrs["http_user_agent"]  = http.get("http_user_agent")
        attrs["http_content_type"] = http.get("http_content_type")
        attrs["length"]           = http.get("length")

    elif event_type == "tls":
        tls = j.get("tls") or {}
        attrs["version"]     = tls.get("version")
        attrs["sni"]         = tls.get("sni")
        attrs["subject"]     = tls.get("subject")
        attrs["issuerdn"]    = tls.get("issuerdn")
        attrs["fingerprint"] = tls.get("fingerprint")
        attrs["ja3_hash"]    = (tls.get("ja3") or {}).get("hash")

    elif event_type == "ssh":
        ssh = j.get("ssh") or {}
        client = ssh.get("client") or {}
        server = ssh.get("server") or {}
        attrs["client_software"]  = client.get("software_version")
        attrs["server_software"]  = server.get("software_version")
        attrs["client_proto"]     = client.get("proto_version")
        attrs["server_proto"]     = server.get("proto_version")

    elif event_type == "anomaly":
        anom = j.get("anomaly") or {}
        attrs["anomaly_event"] = anom.get("event")
        attrs["anomaly_type"]  = anom.get("type")
        attrs["anomaly_layer"] = anom.get("layer")

    # Strip None values
    return {k: v for k, v in attrs.items() if v is not None}


# ── State management ────────────────────────────────────────────────

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


# ── Event converter ─────────────────────────────────────────────────

def eve_to_event(j):
    """Convert a Suricata EVE-JSON object to an orbit-core Event."""
    event_type = j.get("event_type")
    if not event_type or event_type not in EVENT_TYPES:
        return None

    src_ip   = j.get("src_ip") or ""
    flow_id  = str(j.get("flow_id") or "")

    # Timestamp — Suricata uses ISO8601 with timezone
    raw_ts = j.get("timestamp") or ""
    try:
        ts = datetime.fromisoformat(raw_ts).isoformat()
    except Exception:
        ts = datetime.now(timezone.utc).isoformat()

    # Fingerprint for dedup
    if event_type == "alert":
        sig_id = str((j.get("alert") or {}).get("signature_id", ""))
        fingerprint = f"alert:{flow_id}:{sig_id}"
    else:
        fingerprint = f"{event_type}:{flow_id}"

    alert = j.get("alert") or {}

    return {
        "ts":          ts,
        "asset_id":    f"host:{src_ip}" if src_ip else SENSOR_NAME,
        "namespace":   "suricata",
        "kind":        event_type,
        "severity":    _severity(event_type, alert.get("severity")),
        "title":       _title(j, event_type),
        "message":     alert.get("category") or "",
        "fingerprint": fingerprint,
        "attributes":  _attributes(j, event_type),
    }


# ── Main ────────────────────────────────────────────────────────────

def main():
    st = load_state()

    lines, st["offset"] = read_new_lines(EVE_FILE, st["offset"])
    if not lines:
        save_state(st)
        return

    events = []
    skipped = 0
    for ln in lines:
        try:
            j = json.loads(ln)
        except Exception:
            skipped += 1
            continue
        ev = eve_to_event(j)
        if ev:
            events.append(ev)

    if not events:
        save_state(st)
        if skipped:
            print(f"[suricata] {len(lines)} lines read, {skipped} parse errors, 0 events matched", file=sys.stderr)
        return

    s = requests.Session()
    s.headers["X-Source-Id"] = "suricata"
    if ORBIT_API_KEY:
        s.headers["X-Api-Key"] = ORBIT_API_KEY
    else:
        basic = _load_basic_auth()
        if basic:
            s.auth = basic

    shipped = 0
    for i in range(0, len(events), BATCH_SIZE):
        batch = events[i : i + BATCH_SIZE]
        r = s.post(ENDPOINT, json={"events": batch}, timeout=25)
        if r.status_code not in (200, 201):
            raise SystemExit(f"orbit ingest events failed HTTP {r.status_code}: {r.text[:300]}")
        shipped += len(batch)

    save_state(st)
    print(f"[suricata] shipped {shipped} events ({len(lines)} lines, {skipped} errors, types: {','.join(EVENT_TYPES)})")


if __name__ == "__main__":
    main()
