#!/usr/bin/env python3
import os, json, re
from datetime import datetime, timezone
import requests

SVC_FILE = os.environ.get("NAGIOS_SERVICE_PERFDATA_FILE", "/var/lib/nagios4/service-perfdata.out")
HOST_FILE = os.environ.get("NAGIOS_HOST_PERFDATA_FILE", "/var/lib/nagios4/host-perfdata.out")
STATE_PATH = os.environ.get("STATE_PATH", "/var/lib/orbit-core/nagios-metrics.state.json")
MAX_LINES_PER_RUN = int(os.environ.get("MAX_LINES_PER_RUN", "600"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "1000"))

ORBIT_API = os.environ.get("ORBIT_API", "http://127.0.0.1:3000").rstrip("/")
ENDPOINT = f"{ORBIT_API}/api/v1/ingest/metrics"

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
        val = m.group("value")
        mnum = re.match(r"^(-?\d+(?:\.\d+)?)([a-zA-Z%]+)?$", val)
        if not mnum:
            continue
        num = float(mnum.group(1))
        unit = mnum.group(2)
        out.append((label, num, unit))
    return out


def load_state():
    if not os.path.exists(STATE_PATH):
        return {"host_last": 0, "svc_last": 0}
    try:
        with open(STATE_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return {"host_last": 0, "svc_last": 0}


def save_state(st):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w") as f:
        json.dump(st, f)


def read_new_lines(path, last):
    if not os.path.exists(path):
        return [], last
    with open(path, "r", errors="ignore") as f:
        lines = f.readlines()
    total = len(lines)
    if last >= total:
        return [], last
    new = lines[last : last + MAX_LINES_PER_RUN]
    return new, last + len(new)


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

    svc_lines, st["svc_last"] = read_new_lines(SVC_FILE, int(st.get("svc_last", 0)))
    host_lines, st["host_last"] = read_new_lines(HOST_FILE, int(st.get("host_last", 0)))

    out = []

    for line in svc_lines:
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 10:
            continue
        ts = to_ts(parts[0])
        host = parts[1]
        svc = parts[2]
        perf = parts[9]
        for label, num, unit in parse_perf(perf):
            item = {
                "ts": ts,
                "asset_id": f"host:{host}",
                "namespace": "nagios",
                "metric": label,
                "value": num,
                "dimensions": {"service": svc, "kind": "service"},
            }
            if unit:
                item["unit"] = unit
            out.append(item)

    for line in host_lines:
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 8:
            continue
        ts = to_ts(parts[0])
        host = parts[1]
        perf = parts[7]
        for label, num, unit in parse_perf(perf):
            item = {
                "ts": ts,
                "asset_id": f"host:{host}",
                "namespace": "nagios",
                "metric": label,
                "value": num,
                "dimensions": {"service": "__host__", "kind": "host"},
            }
            if unit:
                item["unit"] = unit
            out.append(item)

    post_batches(out)
    save_state(st)


if __name__ == "__main__":
    main()
