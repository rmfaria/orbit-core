#!/usr/bin/env python3
"""
Wazuh (via OpenSearch/Wazuh Indexer) → orbit-core event shipper.  [ACTIVE]

Queries Wazuh alerts from the Wazuh Indexer (OpenSearch) using scroll
pagination and ships them as orbit-core Events.

Run as a cron job every 2 minutes (see cron.example).

Wazuh stores alerts in OpenSearch indices named wazuh-alerts-4.x-YYYY.MM.DD.
Each document is a Wazuh alert. We paginate by @timestamp using a state
file that records the last-seen timestamp to avoid re-ingesting old alerts.
"""
import os, json, fcntl
from datetime import datetime, timezone, timedelta
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── orbit-core API ────────────────────────────────────────────────────────────
ORBIT_API        = os.environ.get("ORBIT_API", "http://127.0.0.1:3000").rstrip("/")
ORBIT_ENDPOINT   = f"{ORBIT_API}/api/v1/ingest/events"
ORBIT_API_KEY    = os.environ.get("ORBIT_API_KEY")
ORBIT_BASIC_USER = os.environ.get("ORBIT_BASIC_USER")
ORBIT_BASIC_PASS = os.environ.get("ORBIT_BASIC_PASS")
ORBIT_BASIC      = os.environ.get("ORBIT_BASIC")
ORBIT_BASIC_FILE = os.environ.get("ORBIT_BASIC_FILE")

# ── OpenSearch / Wazuh Indexer ────────────────────────────────────────────────
OS_URL        = os.environ.get("OPENSEARCH_URL", "").rstrip("/")
OS_USER       = os.environ.get("OPENSEARCH_USER", "")
OS_PASS       = os.environ.get("OPENSEARCH_PASS", "")
OS_INDEX      = os.environ.get("WAZUH_OS_INDEX_PATTERN", "wazuh-alerts-4.x-*")
OS_VERIFY_TLS = os.environ.get("OPENSEARCH_VERIFY_TLS", "true").lower() not in ("0", "false", "no")

# ── tuning ────────────────────────────────────────────────────────────────────
PAGE_SIZE        = int(os.environ.get("PAGE_SIZE", "500"))
BATCH_SIZE       = int(os.environ.get("BATCH_SIZE", "200"))
MAX_EVENTS       = int(os.environ.get("MAX_EVENTS_PER_RUN", "5000"))
# How far back to look on first run (no state file)
LOOKBACK_MINUTES = int(os.environ.get("LOOKBACK_MINUTES", "60"))
# Min severity level to ship (0 = all, 5 = medium+, 10 = high+)
MIN_LEVEL        = int(os.environ.get("MIN_LEVEL", "0"))

STATE_PATH = os.environ.get(
    "STATE_PATH",
    "/var/lib/orbit-core/wazuh-opensearch-events.state.json",
)


# ── severity mapping ──────────────────────────────────────────────────────────
def _level_to_sev(level: int) -> str:
    if level <= 3:  return "info"
    if level <= 6:  return "low"
    if level <= 10: return "medium"
    if level <= 13: return "high"
    return "critical"


# ── auth helpers ──────────────────────────────────────────────────────────────
def _orbit_basic_auth():
    user = ORBIT_BASIC_USER
    pwd  = ORBIT_BASIC_PASS
    if ORBIT_BASIC and ":" in ORBIT_BASIC:
        user, pwd = ORBIT_BASIC.split(":", 1)
    if ORBIT_BASIC_FILE and os.path.exists(ORBIT_BASIC_FILE) and user and not pwd:
        try:
            pwd = open(ORBIT_BASIC_FILE).read().strip()
        except Exception:
            pwd = None
    return (user, pwd) if user and pwd else None


def _orbit_session() -> requests.Session:
    s = requests.Session()
    if ORBIT_API_KEY:
        s.headers["X-Api-Key"] = ORBIT_API_KEY
    else:
        basic = _orbit_basic_auth()
        if basic:
            s.auth = basic
    retry = Retry(total=3, backoff_factor=0.5, status_forcelist=[502, 503, 504])
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://",  HTTPAdapter(max_retries=retry))
    return s


def _os_session() -> requests.Session:
    if not OS_URL:
        raise SystemExit("OPENSEARCH_URL is required")
    s = requests.Session()
    if OS_USER and OS_PASS:
        s.auth = (OS_USER, OS_PASS)
    s.headers["Content-Type"] = "application/json"
    s.verify = OS_VERIFY_TLS
    if not OS_VERIFY_TLS:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    return s


# ── state ─────────────────────────────────────────────────────────────────────
def load_state() -> dict:
    if not os.path.exists(STATE_PATH):
        since = (datetime.now(timezone.utc) - timedelta(minutes=LOOKBACK_MINUTES)).isoformat()
        return {"since": since}
    try:
        with open(STATE_PATH) as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                st = json.load(f)
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
        return {"since": st.get("since", "")}
    except Exception:
        since = (datetime.now(timezone.utc) - timedelta(minutes=LOOKBACK_MINUTES)).isoformat()
        return {"since": since}


def save_state(st: dict):
    os.makedirs(os.path.dirname(os.path.abspath(STATE_PATH)), exist_ok=True)
    with open(STATE_PATH, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            json.dump(st, f)
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


# ── alert → orbit event ───────────────────────────────────────────────────────
def _alert_to_event(doc: dict) -> dict | None:
    """Convert an OpenSearch Wazuh alert document to an orbit-core Event."""
    src   = doc.get("_source", {})
    rule  = src.get("rule") or {}
    agent = src.get("agent") or {}

    rule_level = int(rule.get("level", 0))
    if rule_level < MIN_LEVEL:
        return None

    agent_name = agent.get("name") or agent.get("id")
    if not agent_name:
        return None

    rule_id   = str(rule.get("id", ""))
    rule_desc = rule.get("description") or f"rule {rule_id}"
    groups    = rule.get("groups") or []
    kind      = groups[0] if groups else "alert"

    # prefer @timestamp (OpenSearch), fall back to timestamp (Wazuh field)
    raw_ts = src.get("@timestamp") or src.get("timestamp") or ""
    try:
        ts = datetime.fromisoformat(raw_ts.replace("Z", "+00:00")).isoformat()
    except Exception:
        ts = datetime.now(timezone.utc).isoformat()

    # use OpenSearch _id as fingerprint for exact deduplication
    fingerprint = doc.get("_id") or f"{agent.get('id','')}:{rule_id}:{raw_ts}"

    attributes = {
        "rule_id":     rule_id,
        "rule_level":  rule_level,
        "rule_groups": groups,
        "agent_id":    agent.get("id"),
        "agent_name":  agent.get("name"),
        "agent_ip":    agent.get("ip"),
        "manager":     (src.get("manager") or {}).get("name"),
        "decoder":     (src.get("decoder") or {}).get("name"),
        "location":    src.get("location"),
        "os_index":    doc.get("_index"),
    }
    if src.get("data"):
        attributes["data"] = src["data"]

    return {
        "ts":          ts,
        "asset_id":    f"host:{agent_name}",
        "namespace":   "wazuh",
        "kind":        kind,
        "severity":    _level_to_sev(rule_level),
        "title":       rule_desc,
        "message":     src.get("full_log") or "",
        "fingerprint": fingerprint,
        "attributes":  {k: v for k, v in attributes.items() if v is not None},
    }


# ── OpenSearch query ──────────────────────────────────────────────────────────
def fetch_alerts(os_sess: requests.Session, since_iso: str) -> tuple[list[dict], str]:
    """
    Paginate OpenSearch for Wazuh alerts newer than since_iso.
    Returns (list_of_orbit_events, new_since_iso).
    """
    query = {
        "size": PAGE_SIZE,
        "sort": [{"@timestamp": "asc"}, {"_id": "asc"}],
        "query": {
            "bool": {
                "filter": [
                    {"range": {"@timestamp": {"gt": since_iso}}}
                ]
            }
        },
        "_source": [
            "@timestamp", "timestamp", "rule", "agent",
            "manager", "decoder", "location", "full_log", "data",
        ],
    }

    events: list[dict] = []
    last_ts = since_iso
    search_after: list | None = None

    while len(events) < MAX_EVENTS:
        if search_after:
            query["search_after"] = search_after

        url = f"{OS_URL}/{OS_INDEX}/_search"
        r = os_sess.post(url, json=query, timeout=30)
        if r.status_code == 404:
            break  # index doesn't exist yet
        r.raise_for_status()

        hits = r.json().get("hits", {}).get("hits", [])
        if not hits:
            break

        for doc in hits:
            ev = _alert_to_event(doc)
            if ev:
                events.append(ev)
                if ev["ts"] > last_ts:
                    last_ts = ev["ts"]

        if len(hits) < PAGE_SIZE:
            break  # last page

        # search_after uses sort values of last hit
        search_after = hits[-1].get("sort")
        if not search_after:
            break

    return events, last_ts


# ── ship to orbit-core ────────────────────────────────────────────────────────
def ship(orbit_sess: requests.Session, events: list[dict]):
    for i in range(0, len(events), BATCH_SIZE):
        batch = events[i : i + BATCH_SIZE]
        r = orbit_sess.post(ORBIT_ENDPOINT, json={"events": batch}, timeout=25)
        if r.status_code not in (200, 201):
            raise SystemExit(
                f"orbit ingest/events failed HTTP {r.status_code}: {r.text[:300]}"
            )


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    st = load_state()
    since = st["since"]

    os_sess    = _os_session()
    orbit_sess = _orbit_session()

    events, new_since = fetch_alerts(os_sess, since)

    if events:
        ship(orbit_sess, events)

    # always advance since, even if no events (avoids re-querying the same window)
    if new_since > since:
        st["since"] = new_since
    else:
        # advance by 1 second to avoid re-querying empty window next run
        try:
            dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            st["since"] = (dt + timedelta(seconds=1)).isoformat()
        except Exception:
            pass

    save_state(st)


if __name__ == "__main__":
    main()
