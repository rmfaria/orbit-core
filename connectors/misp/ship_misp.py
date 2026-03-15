#!/usr/bin/env python3
# orbit-core
#
# Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
# SPDX-License-Identifier: Apache-2.0

"""
MISP → orbit-core threat intelligence shipper.

Pulls IoC attributes and events from a MISP instance REST API and ships them
to orbit-core's threat intel ingest endpoint.

Tracks state via timestamp of last successful pull. On first run, pulls
indicators published in the last 24 hours (configurable via INITIAL_LOOKBACK_HOURS).

Run as a cron job every 5 minutes (see cron.example).

Required env vars:
  MISP_URL       — e.g. https://misp.example.com
  MISP_API_KEY   — MISP automation/API key
  ORBIT_API      — orbit-core base URL
  ORBIT_API_KEY  — orbit-core API key
"""
import os
import json
import sys
import logging
import fcntl
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("misp-shipper")

# ── Configuration ────────────────────────────────────────────────────────────

MISP_URL          = os.environ.get("MISP_URL", "").rstrip("/")
MISP_API_KEY      = os.environ.get("MISP_API_KEY", "")
MISP_VERIFY_TLS   = os.environ.get("MISP_VERIFY_TLS", "true").lower() not in ("0", "false", "no")

ORBIT_API         = os.environ.get("ORBIT_API", "http://127.0.0.1:3000").rstrip("/")
ORBIT_API_KEY     = os.environ.get("ORBIT_API_KEY")
ORBIT_BASIC_USER  = os.environ.get("ORBIT_BASIC_USER")
ORBIT_BASIC_PASS  = os.environ.get("ORBIT_BASIC_PASS")

BATCH_SIZE        = int(os.environ.get("BATCH_SIZE", "200"))
SOURCE_ID         = os.environ.get("SOURCE_ID", "misp")
STATE_PATH        = os.environ.get("STATE_PATH", "/var/lib/orbit-core/misp.state.json")

# First run: how far back to look (hours)
INITIAL_LOOKBACK_HOURS = int(os.environ.get("INITIAL_LOOKBACK_HOURS", "24"))

# Filter: only pull attributes with to_ids=True (actionable IoCs)
ONLY_IDS          = os.environ.get("ONLY_IDS", "true").lower() not in ("0", "false", "no")

# Filter: attribute types to include (empty = all)
INCLUDE_TYPES     = [t.strip() for t in os.environ.get("INCLUDE_TYPES", "").split(",") if t.strip()]

# Max attributes per run (safety valve)
MAX_ATTRIBUTES    = int(os.environ.get("MAX_ATTRIBUTES", "10000"))


# ── MISP threat level mapping ───────────────────────────────────────────────

_MISP_THREAT_LEVEL = {
    "1": "high",
    "2": "medium",
    "3": "low",
    "4": "undefined",
}


# ── State management ────────────────────────────────────────────────────────

def load_state() -> dict:
    """Load state from JSON file (last pull timestamp)."""
    path = Path(STATE_PATH)
    if not path.exists():
        return {}
    try:
        with open(path, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            data = json.load(f)
            fcntl.flock(f, fcntl.LOCK_UN)
            return data
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s — starting fresh", e)
        return {}


def save_state(state: dict):
    """Save state to JSON file."""
    path = Path(STATE_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        json.dump(state, f)
        fcntl.flock(f, fcntl.LOCK_UN)


# ── MISP client ─────────────────────────────────────────────────────────────

class MispClient:
    """Thin wrapper around the MISP REST API."""

    def __init__(self, base_url: str, api_key: str, verify: bool = True):
        self.base = base_url
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": api_key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        })
        self.session.verify = verify
        if not verify:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        retry = Retry(total=3, backoff_factor=1, status_forcelist=[502, 503, 504])
        self.session.mount("https://", HTTPAdapter(max_retries=retry))
        self.session.mount("http://",  HTTPAdapter(max_retries=retry))

    def search_attributes(self, timestamp: str, **kwargs) -> list[dict]:
        """Search MISP attributes modified since timestamp.

        Args:
            timestamp: ISO 8601 or UNIX epoch string
            **kwargs: additional MISP restSearch params
        """
        body: dict[str, Any] = {
            "timestamp": timestamp,
            "limit": MAX_ATTRIBUTES,
            "includeEventTags": True,
            **kwargs,
        }
        if ONLY_IDS:
            body["to_ids"] = True
        if INCLUDE_TYPES:
            body["type"] = {"OR": INCLUDE_TYPES}

        r = self.session.post(
            f"{self.base}/attributes/restSearch",
            json=body,
            timeout=60,
        )
        r.raise_for_status()
        data = r.json()

        # MISP returns {"response": {"Attribute": [...]}}
        response = data.get("response", {})
        if isinstance(response, dict):
            return response.get("Attribute", [])
        return []

    def search_events(self, timestamp: str, **kwargs) -> list[dict]:
        """Search MISP events modified since timestamp."""
        body: dict[str, Any] = {
            "timestamp": timestamp,
            "limit": 500,
            **kwargs,
        }

        r = self.session.post(
            f"{self.base}/events/restSearch",
            json=body,
            timeout=60,
        )
        r.raise_for_status()
        data = r.json()

        response = data.get("response", [])
        if isinstance(response, list):
            return [item.get("Event", item) for item in response]
        return []


# ── Transform: MISP → orbit threat indicators ───────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_tags(attr: dict) -> list[str]:
    """Extract tag names from a MISP attribute."""
    tags = []
    for tag in attr.get("Tag", []):
        name = tag.get("name", "")
        if name:
            tags.append(name)
    # Also include event-level tags if present
    event = attr.get("Event", {})
    for tag in event.get("Tag", []):
        name = tag.get("name", "")
        if name and name not in tags:
            tags.append(name)
    return tags


def transform_attributes(attributes: list[dict], events_map: dict[str, dict]) -> list[dict]:
    """Transform MISP attributes into orbit threat indicators."""
    indicators: list[dict] = []

    for attr in attributes:
        attr_type = attr.get("type", "unknown")
        attr_value = attr.get("value", "")
        if not attr_value:
            continue

        # Resolve event info
        event_id = str(attr.get("event_id", ""))
        event = events_map.get(event_id, attr.get("Event", {}))
        threat_level_id = str(event.get("threat_level_id", "4"))
        event_info = event.get("info", "")

        tags = _extract_tags(attr)

        indicators.append({
            "source": "misp",
            "source_id": attr.get("uuid", str(attr.get("id", ""))),
            "type": attr_type,
            "value": attr_value,
            "threat_level": _MISP_THREAT_LEVEL.get(threat_level_id, "unknown"),
            "tags": tags,
            "event_info": event_info,
            "comment": attr.get("comment") or None,
            "attributes": {
                "misp_event_id": event_id,
                "misp_event_uuid": event.get("uuid"),
                "misp_attr_id": str(attr.get("id", "")),
                "category": attr.get("category"),
                "to_ids": attr.get("to_ids", False),
                "distribution": attr.get("distribution"),
                "first_seen": attr.get("first_seen"),
                "last_seen": attr.get("last_seen"),
                "org": event.get("Orgc", {}).get("name"),
            },
            "first_seen": attr.get("first_seen") or _now_iso(),
            "last_seen": _now_iso(),
        })

    return indicators


# ── Also generate orbit events for high-severity IoCs ───────────────────────

def indicators_to_events(indicators: list[dict]) -> list[dict]:
    """Convert high/medium threat indicators into orbit events for visibility."""
    events: list[dict] = []
    for ind in indicators:
        if ind["threat_level"] not in ("high", "medium"):
            continue

        severity = "high" if ind["threat_level"] == "high" else "medium"
        events.append({
            "ts": ind["last_seen"],
            "asset_id": f"misp:{ind['type']}",
            "namespace": "misp",
            "kind": "ioc.new",
            "severity": severity,
            "title": f"[MISP] {ind['type']}: {ind['value'][:120]}",
            "message": ind.get("event_info") or ind.get("comment"),
            "fingerprint": f"misp:ioc:{ind['source_id']}",
            "attributes": {
                "ioc_type": ind["type"],
                "ioc_value": ind["value"],
                "threat_level": ind["threat_level"],
                "tags": ind["tags"],
                "misp_event_id": ind["attributes"].get("misp_event_id"),
                "org": ind["attributes"].get("org"),
            },
        })

    return events


# ── Orbit shipper ────────────────────────────────────────────────────────────

class OrbitShipper:
    """Ships threat indicators and events to orbit-core."""

    def __init__(self, base_url: str):
        self.indicators_url = f"{base_url}/api/v1/threat-intel/indicators"
        self.events_url     = f"{base_url}/api/v1/ingest/events"
        self.session = requests.Session()
        if ORBIT_API_KEY:
            self.session.headers["X-Api-Key"] = ORBIT_API_KEY
        elif ORBIT_BASIC_USER and ORBIT_BASIC_PASS:
            self.session.auth = (ORBIT_BASIC_USER, ORBIT_BASIC_PASS)
        self.session.headers["X-Source-Id"] = SOURCE_ID
        retry = Retry(total=3, backoff_factor=0.5, status_forcelist=[502, 503, 504])
        self.session.mount("https://", HTTPAdapter(max_retries=retry))
        self.session.mount("http://",  HTTPAdapter(max_retries=retry))

    def ship_indicators(self, indicators: list[dict]):
        """POST indicators in batches to threat-intel endpoint."""
        for i in range(0, len(indicators), BATCH_SIZE):
            batch = indicators[i : i + BATCH_SIZE]
            r = self.session.post(
                self.indicators_url,
                json={"indicators": batch},
                timeout=25,
            )
            if r.status_code not in (200, 201):
                log.error("Indicator ingest failed HTTP %d: %s", r.status_code, r.text[:300])
                raise RuntimeError(f"Indicator ingest failed: {r.status_code}")
        if indicators:
            log.info("Shipped %d indicators", len(indicators))

    def ship_events(self, events: list[dict]):
        """POST events to standard ingest endpoint."""
        for i in range(0, len(events), BATCH_SIZE):
            batch = events[i : i + BATCH_SIZE]
            r = self.session.post(
                self.events_url,
                json={"events": batch},
                timeout=25,
            )
            if r.status_code not in (200, 201):
                log.error("Events ingest failed HTTP %d: %s", r.status_code, r.text[:300])
                raise RuntimeError(f"Events ingest failed: {r.status_code}")
        if events:
            log.info("Shipped %d events", len(events))


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not MISP_URL:
        log.error("MISP_URL is required")
        sys.exit(1)
    if not MISP_API_KEY:
        log.error("MISP_API_KEY is required")
        sys.exit(1)

    # Determine timestamp for incremental pull
    state = load_state()
    last_ts = state.get("last_timestamp")
    if last_ts:
        since = last_ts
        log.info("Resuming from timestamp: %s", since)
    else:
        since = (datetime.now(timezone.utc) - timedelta(hours=INITIAL_LOOKBACK_HOURS)).strftime("%s")
        log.info("First run — looking back %d hours", INITIAL_LOOKBACK_HOURS)

    misp = MispClient(MISP_URL, MISP_API_KEY, MISP_VERIFY_TLS)
    orbit = OrbitShipper(ORBIT_API)

    # 1. Fetch MISP events (for metadata: threat_level, info, org)
    log.info("Fetching MISP events since %s...", since)
    try:
        misp_events = misp.search_events(since)
    except Exception as e:
        log.error("Failed to fetch MISP events: %s", e)
        misp_events = []

    events_map: dict[str, dict] = {}
    for ev in misp_events:
        eid = str(ev.get("id", ""))
        if eid:
            events_map[eid] = ev

    log.info("Fetched %d MISP events", len(misp_events))

    # 2. Fetch MISP attributes (the actual IoCs)
    log.info("Fetching MISP attributes since %s...", since)
    try:
        misp_attrs = misp.search_attributes(since)
    except Exception as e:
        log.error("Failed to fetch MISP attributes: %s", e)
        sys.exit(1)

    log.info("Fetched %d MISP attributes", len(misp_attrs))

    if not misp_attrs:
        log.info("No new attributes — nothing to ship")
        # Still update timestamp to avoid re-fetching
        state["last_timestamp"] = str(int(datetime.now(timezone.utc).timestamp()))
        save_state(state)
        return

    # 3. Transform to orbit indicators
    indicators = transform_attributes(misp_attrs, events_map)
    log.info("Transformed %d indicators", len(indicators))

    # 4. Generate orbit events for high-severity IoCs
    orbit_events = indicators_to_events(indicators)
    log.info("Generated %d orbit events from high/medium IoCs", len(orbit_events))

    # 5. Ship to orbit-core
    if indicators:
        orbit.ship_indicators(indicators)
    if orbit_events:
        orbit.ship_events(orbit_events)

    # 6. Update state
    state["last_timestamp"] = str(int(datetime.now(timezone.utc).timestamp()))
    state["last_run"] = _now_iso()
    state["last_count"] = len(indicators)
    save_state(state)

    log.info("Done: %d indicators, %d events shipped", len(indicators), len(orbit_events))


if __name__ == "__main__":
    main()
