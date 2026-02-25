#!/usr/bin/env python3
# orbit-core
#
# Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
# SPDX-License-Identifier: Apache-2.0

"""
n8n → orbit-core event shipper.  [ACTIVE]

Polls the n8n REST API for:
  - Failed executions (status=error) newer than last seen timestamp
  - Stuck running executions older than STUCK_AFTER_MINUTES

Ships events to orbit-core via POST /api/v1/ingest/events.

Run as a cron job every minute (see cron.example).
"""
import os, json, fcntl
from datetime import datetime, timezone, timedelta
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── n8n source ────────────────────────────────────────────────────────────────
N8N_URL        = os.environ.get("N8N_URL", "http://localhost:5678").rstrip("/")
N8N_API_KEY    = os.environ.get("N8N_API_KEY", "")
N8N_VERIFY_TLS = os.environ.get("N8N_VERIFY_TLS", "true").lower() not in ("0", "false", "no")

# ── tuning ────────────────────────────────────────────────────────────────────
STUCK_AFTER_MINUTES    = int(os.environ.get("STUCK_AFTER_MINUTES", "30"))
MAX_EXECUTIONS_PER_RUN = int(os.environ.get("MAX_EXECUTIONS_PER_RUN", "500"))
BATCH_SIZE             = int(os.environ.get("BATCH_SIZE", "200"))
LOOKBACK_MINUTES       = int(os.environ.get("LOOKBACK_MINUTES", "60"))
PAGE_LIMIT             = 100  # n8n API max per page

# ── orbit-core destination ────────────────────────────────────────────────────
ORBIT_API      = os.environ.get("ORBIT_API", "http://127.0.0.1:3000").rstrip("/")
ORBIT_ENDPOINT = f"{ORBIT_API}/api/v1/ingest/events"

ORBIT_API_KEY    = os.environ.get("ORBIT_API_KEY")
ORBIT_BASIC_USER = os.environ.get("ORBIT_BASIC_USER")
ORBIT_BASIC_PASS = os.environ.get("ORBIT_BASIC_PASS")
ORBIT_BASIC      = os.environ.get("ORBIT_BASIC")
ORBIT_BASIC_FILE = os.environ.get("ORBIT_BASIC_FILE")

STATE_PATH = os.environ.get(
    "STATE_PATH",
    "/var/lib/orbit-core/n8n-events.state.json",
)


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


def _n8n_session() -> requests.Session:
    if not N8N_API_KEY:
        raise SystemExit("N8N_API_KEY is required")
    s = requests.Session()
    s.headers["X-N8N-API-KEY"] = N8N_API_KEY
    s.headers["Accept"] = "application/json"
    s.verify = N8N_VERIFY_TLS
    if not N8N_VERIFY_TLS:
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


# ── n8n API helpers ───────────────────────────────────────────────────────────
def _fetch_page(sess: requests.Session, status: str, cursor: str | None) -> dict:
    params: dict = {"status": status, "limit": PAGE_LIMIT, "includeData": "false"}
    if cursor:
        params["cursor"] = cursor
    r = sess.get(f"{N8N_URL}/api/v1/executions", params=params, timeout=30)
    r.raise_for_status()
    return r.json()


# ── event builders ────────────────────────────────────────────────────────────
def _to_error_event(ex: dict) -> dict:
    wf_name   = (ex.get("workflowData") or {}).get("name") or str(ex.get("workflowId", "unknown"))
    exec_id   = str(ex.get("id", ""))
    wf_id     = str(ex.get("workflowId", ""))
    stopped   = ex.get("stoppedAt") or ex.get("startedAt") or datetime.now(timezone.utc).isoformat()

    try:
        ts = datetime.fromisoformat(stopped.replace("Z", "+00:00")).isoformat()
    except Exception:
        ts = datetime.now(timezone.utc).isoformat()

    return {
        "ts":          ts,
        "asset_id":    f"workflow:{wf_name}",
        "namespace":   "n8n",
        "kind":        "execution_error",
        "severity":    "high",
        "title":       f"Workflow \"{wf_name}\" failed (execution {exec_id})",
        "message":     f"Execution {exec_id} for workflow \"{wf_name}\" ended with status=error.",
        "fingerprint": f"n8n:error:{exec_id}",
        "attributes": {
            "execution_id":  exec_id,
            "workflow_id":   wf_id,
            "workflow_name": wf_name,
            "status":        "error",
            "started_at":    ex.get("startedAt"),
            "stopped_at":    ex.get("stoppedAt"),
            "n8n_url":       N8N_URL,
        },
    }


def _to_stuck_event(ex: dict, stuck_minutes: float) -> dict:
    wf_name  = (ex.get("workflowData") or {}).get("name") or str(ex.get("workflowId", "unknown"))
    exec_id  = str(ex.get("id", ""))
    wf_id    = str(ex.get("workflowId", ""))
    started  = ex.get("startedAt") or datetime.now(timezone.utc).isoformat()

    return {
        "ts":          datetime.now(timezone.utc).isoformat(),
        "asset_id":    f"workflow:{wf_name}",
        "namespace":   "n8n",
        "kind":        "execution_stuck",
        "severity":    "medium",
        "title":       f"Workflow \"{wf_name}\" stuck for {int(stuck_minutes)}m (execution {exec_id})",
        "message":     (
            f"Execution {exec_id} for workflow \"{wf_name}\" has been running for "
            f"{int(stuck_minutes)} minutes (threshold: {STUCK_AFTER_MINUTES}m)."
        ),
        "fingerprint": f"n8n:stuck:{exec_id}",
        "attributes": {
            "execution_id":      exec_id,
            "workflow_id":       wf_id,
            "workflow_name":     wf_name,
            "status":            "running",
            "started_at":        started,
            "stuck_minutes":     round(stuck_minutes, 1),
            "stuck_threshold_m": STUCK_AFTER_MINUTES,
            "n8n_url":           N8N_URL,
        },
    }


# ── fetch phases ──────────────────────────────────────────────────────────────
def fetch_error_events(sess: requests.Session, since: str) -> tuple[list[dict], str]:
    """
    Page through status=error executions collecting those with stoppedAt > since.
    n8n returns newest first — stops paging early once a full page is older than since.
    Returns (orbit_events, new_since).
    """
    events: list[dict] = []
    new_since = since
    cursor: str | None = None

    while len(events) < MAX_EXECUTIONS_PER_RUN:
        page  = _fetch_page(sess, "error", cursor)
        items = page.get("data") or []
        if not items:
            break

        page_had_new = False
        for ex in items:
            stopped = ex.get("stoppedAt") or ex.get("startedAt") or ""
            if stopped and stopped > since:
                events.append(_to_error_event(ex))
                page_had_new = True
                if stopped > new_since:
                    new_since = stopped

        # all items on this page are older than since — stop paging
        if not page_had_new:
            break

        next_cursor = page.get("nextCursor")
        if not next_cursor:
            break
        cursor = next_cursor

    return events, new_since


def fetch_stuck_events(sess: requests.Session) -> list[dict]:
    """Return events for running executions older than STUCK_AFTER_MINUTES."""
    events: list[dict] = []
    cursor: str | None = None
    now       = datetime.now(timezone.utc)
    threshold = timedelta(minutes=STUCK_AFTER_MINUTES)

    while True:
        page  = _fetch_page(sess, "running", cursor)
        items = page.get("data") or []
        if not items:
            break

        for ex in items:
            raw = ex.get("startedAt")
            if not raw:
                continue
            try:
                started = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except Exception:
                continue
            age = now - started
            if age > threshold:
                events.append(_to_stuck_event(ex, age.total_seconds() / 60))

        next_cursor = page.get("nextCursor")
        if not next_cursor:
            break
        cursor = next_cursor

    return events


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
    st    = load_state()
    since = st["since"]

    n8n_sess   = _n8n_session()
    orbit_sess = _orbit_session()

    # Phase 1: new error executions
    error_events, new_since = fetch_error_events(n8n_sess, since)

    # Phase 2: stuck running executions
    stuck_events = fetch_stuck_events(n8n_sess)

    all_events = error_events + stuck_events
    if all_events:
        ship(orbit_sess, all_events)

    # advance since; if no new events, nudge by 1s to avoid re-querying same window
    if new_since > since:
        st["since"] = new_since
    else:
        try:
            dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            st["since"] = (dt + timedelta(seconds=1)).isoformat()
        except Exception:
            pass

    save_state(st)


if __name__ == "__main__":
    main()
