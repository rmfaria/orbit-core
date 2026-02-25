#!/usr/bin/env python3
# orbit-core
#
# Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
# SPDX-License-Identifier: Apache-2.0

import os, json, re, fcntl
from datetime import datetime, timezone
import requests

SVC_FILE  = os.environ.get("NAGIOS_SERVICE_PERFDATA_FILE", "/var/lib/nagios4/service-perfdata.out")
HOST_FILE = os.environ.get("NAGIOS_HOST_PERFDATA_FILE",    "/var/lib/nagios4/host-perfdata.out")
STATE_PATH        = os.environ.get("STATE_PATH",        "/var/lib/orbit-core/nagios-metrics.state.json")
MAX_BYTES_PER_RUN = int(os.environ.get("MAX_BYTES_PER_RUN", str(5 * 1024 * 1024)))  # 5 MB
BATCH_SIZE        = int(os.environ.get("BATCH_SIZE", "1000"))

ORBIT_API = os.environ.get("ORBIT_API", "http://127.0.0.1:3000").rstrip("/")
ENDPOINT  = f"{ORBIT_API}/api/v1/ingest/metrics"

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


PERF_PAIR_RE = re.compile(r"(?P<label>[^=\s]+)=(?P<value>[^;\s]+)(?P<rest>.*)")


def parse_perf(perf: str):
    if not perf:
        return []
    out = []
    for token in perf.strip().split():
        m = PERF_PAIR_RE.match(token)
        if not m:
            continue
        label = m.group("label")
        val   = m.group("value")
        mnum  = re.match(r"^(-?\d+(?:\.\d+)?)([a-zA-Z%]+)?$", val)
        if not mnum:
            continue
        num  = float(mnum.group(1))
        unit = mnum.group(2)
        out.append((label, num, unit))
    return out


def load_state():
    if not os.path.exists(STATE_PATH):
        return {"svc_offset": 0, "host_offset": 0}
    try:
        with open(STATE_PATH, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                st = json.load(f)
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
        return {
            "svc_offset":  int(st.get("svc_offset",  0)),
            "host_offset": int(st.get("host_offset", 0)),
        }
    except Exception:
        return {"svc_offset": 0, "host_offset": 0}


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
    lines = [l for l in text.splitlines() if l.strip()]

    return lines, offset + len(complete)


def to_ts(epoch_str: str):
    try:
        ep = int(float(epoch_str))
        return datetime.fromtimestamp(ep, tz=timezone.utc).isoformat()
    except Exception:
        return datetime.now(tz=timezone.utc).isoformat()


def post_batches(points):
    if not points:
        return
    s = requests.Session()
    if ORBIT_API_KEY:
        s.headers["X-Api-Key"] = ORBIT_API_KEY
    else:
        basic = _load_basic_auth()
        if basic:
            s.auth = basic
    for i in range(0, len(points), BATCH_SIZE):
        batch = points[i : i + BATCH_SIZE]
        r = s.post(ENDPOINT, json={"metrics": batch}, timeout=25)
        if r.status_code not in (200, 201):
            raise SystemExit(
                f"orbit ingest metrics failed HTTP {r.status_code}: {r.text[:300]}"
            )


def main():
    st = load_state()

    svc_lines,  st["svc_offset"]  = read_new_lines(SVC_FILE,  st["svc_offset"])
    host_lines, st["host_offset"] = read_new_lines(HOST_FILE, st["host_offset"])

    out = []

    # Default Nagios service perfdata template (tab-separated, positional):
    # [0]epoch [1]host [2]servicedesc [3]state [4]attempt [5]statetype
    # [6]exectime [7]latency [8]output [9]perfdata
    for line in svc_lines:
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 10:
            continue
        ts   = to_ts(parts[0])
        host = parts[1]
        svc  = parts[2]
        perf = parts[9]
        for label, num, unit in parse_perf(perf):
            item = {
                "ts":         ts,
                "asset_id":   f"host:{host}",
                "namespace":  "nagios",
                "metric":     label,
                "value":      num,
                "dimensions": {"service": svc, "kind": "service"},
            }
            if unit:
                item["unit"] = unit
            out.append(item)

    # Default Nagios host perfdata template (tab-separated, positional):
    # [0]epoch [1]host [2]state [3]attempt [4]statetype [5]exectime [6]latency [7]perfdata
    for line in host_lines:
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 8:
            continue
        ts   = to_ts(parts[0])
        host = parts[1]
        perf = parts[7]
        for label, num, unit in parse_perf(perf):
            item = {
                "ts":         ts,
                "asset_id":   f"host:{host}",
                "namespace":  "nagios",
                "metric":     label,
                "value":      num,
                "dimensions": {"service": "__host__", "kind": "host"},
            }
            if unit:
                item["unit"] = unit
            out.append(item)

    post_batches(out)
    save_state(st)


if __name__ == "__main__":
    main()
