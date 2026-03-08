#!/usr/bin/env python3
# orbit-core
#
# Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
# SPDX-License-Identifier: Apache-2.0

"""
Wazuh REST API → orbit-core structured data shipper.

Pulls agents, SCA, MITRE ATT&CK, syscollector, and manager stats from the
Wazuh REST API and ships them as structured metrics + events to orbit-core.

Unlike ship_events.py (file-based alerts) and ship_events_opensearch.py
(OpenSearch query-based alerts), this connector focuses on inventory and
compliance data that the Wazuh API exposes natively.

Run as a cron job every 5 minutes (see cron.example).

Required env vars:
  WAZUH_API_URL   — e.g. https://gm-sec.nebrasil.com.br:55000
  WAZUH_API_USER  — API user (e.g. wazuh-wui)
  WAZUH_API_PASS  — API password
  ORBIT_API       — orbit-core base URL
  ORBIT_API_KEY   — orbit-core API key (or use ORBIT_BASIC_*)
"""
import os
import json
import sys
import logging
from datetime import datetime, timezone
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
log = logging.getLogger("wazuh-api")

# ── Configuration ────────────────────────────────────────────────────────────

WAZUH_API_URL    = os.environ.get("WAZUH_API_URL", "").rstrip("/")
WAZUH_API_USER   = os.environ.get("WAZUH_API_USER", "wazuh-wui")
WAZUH_API_PASS   = os.environ.get("WAZUH_API_PASS", "")
# H7-fix: default to TLS verification enabled
WAZUH_VERIFY_TLS = os.environ.get("WAZUH_VERIFY_TLS", "true").lower() not in ("0", "false", "no")

ORBIT_API        = os.environ.get("ORBIT_API", "http://127.0.0.1:3000").rstrip("/")
ORBIT_API_KEY    = os.environ.get("ORBIT_API_KEY")
ORBIT_BASIC_USER = os.environ.get("ORBIT_BASIC_USER")
ORBIT_BASIC_PASS = os.environ.get("ORBIT_BASIC_PASS")

BATCH_SIZE       = int(os.environ.get("BATCH_SIZE", "200"))
SOURCE_ID        = os.environ.get("SOURCE_ID", "wazuh-api")

# Feature flags — disable individual collectors if needed
COLLECT_AGENTS      = os.environ.get("COLLECT_AGENTS", "true").lower() not in ("0", "false", "no")
COLLECT_SCA         = os.environ.get("COLLECT_SCA", "true").lower() not in ("0", "false", "no")
COLLECT_MITRE       = os.environ.get("COLLECT_MITRE", "true").lower() not in ("0", "false", "no")
COLLECT_SYSCOLLECTOR = os.environ.get("COLLECT_SYSCOLLECTOR", "true").lower() not in ("0", "false", "no")
COLLECT_STATS       = os.environ.get("COLLECT_STATS", "true").lower() not in ("0", "false", "no")
COLLECT_VULN        = os.environ.get("COLLECT_VULN", "true").lower() not in ("0", "false", "no")


# ── Wazuh API client ────────────────────────────────────────────────────────

class WazuhClient:
    """Thin wrapper around the Wazuh REST API with JWT auth."""

    def __init__(self, base_url: str, user: str, password: str, verify: bool = False):
        self.base = base_url
        self.user = user
        self.password = password
        self.session = requests.Session()
        self.session.verify = verify
        if not verify:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        retry = Retry(total=3, backoff_factor=0.5, status_forcelist=[502, 503, 504])
        self.session.mount("https://", HTTPAdapter(max_retries=retry))
        self.token: str | None = None

    def authenticate(self):
        """Get JWT token from Wazuh API."""
        r = self.session.post(
            f"{self.base}/security/user/authenticate",
            auth=(self.user, self.password),
            timeout=15,
        )
        r.raise_for_status()
        self.token = r.json().get("data", {}).get("token")
        if not self.token:
            raise RuntimeError("Wazuh auth returned no token")
        self.session.headers["Authorization"] = f"Bearer {self.token}"
        log.info("Wazuh API authenticated")

    def get(self, path: str, params: dict | None = None, timeout: int = 30) -> dict:
        """GET request with auto-retry on 401 (token expired)."""
        url = f"{self.base}{path}"
        r = self.session.get(url, params=params, timeout=timeout)
        if r.status_code == 401:
            log.info("Token expired, re-authenticating")
            self.authenticate()
            r = self.session.get(url, params=params, timeout=timeout)
        r.raise_for_status()
        return r.json()

    def get_all(self, path: str, params: dict | None = None, limit: int = 500) -> list[dict]:
        """Paginate through all results for a given endpoint."""
        params = dict(params or {})
        params.setdefault("limit", limit)
        params.setdefault("offset", 0)
        all_items: list[dict] = []

        while True:
            data = self.get(path, params)
            items = data.get("data", {}).get("affected_items", [])
            all_items.extend(items)
            total = data.get("data", {}).get("total_affected_items", 0)
            if len(all_items) >= total or not items:
                break
            params["offset"] = len(all_items)

        return all_items


# ── orbit-core shipper ───────────────────────────────────────────────────────

class OrbitShipper:
    """Ships metrics and events to orbit-core ingest API."""

    def __init__(self, base_url: str):
        self.metrics_url = f"{base_url}/api/v1/ingest/metrics"
        self.events_url  = f"{base_url}/api/v1/ingest/events"
        self.session = requests.Session()
        if ORBIT_API_KEY:
            self.session.headers["X-Api-Key"] = ORBIT_API_KEY
        elif ORBIT_BASIC_USER and ORBIT_BASIC_PASS:
            self.session.auth = (ORBIT_BASIC_USER, ORBIT_BASIC_PASS)
        self.session.headers["X-Source-Id"] = SOURCE_ID
        retry = Retry(total=3, backoff_factor=0.5, status_forcelist=[502, 503, 504])
        self.session.mount("https://", HTTPAdapter(max_retries=retry))
        self.session.mount("http://",  HTTPAdapter(max_retries=retry))

    def ship_metrics(self, metrics: list[dict]):
        for i in range(0, len(metrics), BATCH_SIZE):
            batch = metrics[i : i + BATCH_SIZE]
            r = self.session.post(self.metrics_url, json={"metrics": batch}, timeout=25)
            if r.status_code not in (200, 201):
                log.error("Metrics ingest failed HTTP %d: %s", r.status_code, r.text[:300])
                raise RuntimeError(f"Metrics ingest failed: {r.status_code}")
        if metrics:
            log.info("Shipped %d metrics", len(metrics))

    def ship_events(self, events: list[dict]):
        for i in range(0, len(events), BATCH_SIZE):
            batch = events[i : i + BATCH_SIZE]
            r = self.session.post(self.events_url, json={"events": batch}, timeout=25)
            if r.status_code not in (200, 201):
                log.error("Events ingest failed HTTP %d: %s", r.status_code, r.text[:300])
                raise RuntimeError(f"Events ingest failed: {r.status_code}")
        if events:
            log.info("Shipped %d events", len(events))


# ── Collectors ───────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def collect_agents(wz: WazuhClient) -> tuple[list[dict], list[dict]]:
    """Collect agent inventory → metrics (status counts) + events (per-agent snapshot)."""
    log.info("Collecting agents...")
    agents = wz.get_all("/agents", {"select": "id,name,ip,status,os.name,os.version,os.platform,version,lastKeepAlive,dateAdd,group,node_name"})

    ts = _now_iso()
    metrics: list[dict] = []
    events: list[dict] = []

    # Summary metrics
    status_counts: dict[str, int] = {}
    for a in agents:
        st = a.get("status", "unknown")
        status_counts[st] = status_counts.get(st, 0) + 1

    metrics.append({
        "ts": ts,
        "asset_id": "wazuh:manager",
        "namespace": "wazuh",
        "metric": "agents.total",
        "value": len(agents),
        "unit": "count",
    })

    for status, count in status_counts.items():
        metrics.append({
            "ts": ts,
            "asset_id": "wazuh:manager",
            "namespace": "wazuh",
            "metric": f"agents.status.{status}",
            "value": count,
            "unit": "count",
        })

    # Per-agent snapshot events
    for a in agents:
        agent_name = a.get("name", a.get("id", "unknown"))
        # Wazuh returns os info as nested dict: {"os": {"name": ..., "version": ...}}
        os_obj = a.get("os") or {}
        os_name = os_obj.get("name", "") if isinstance(os_obj, dict) else ""
        os_version = os_obj.get("version", "") if isinstance(os_obj, dict) else ""
        os_platform = os_obj.get("platform", "") if isinstance(os_obj, dict) else ""
        os_info = f"{os_name} {os_version}".strip()

        events.append({
            "ts": ts,
            "asset_id": f"host:{agent_name}",
            "namespace": "wazuh",
            "kind": "agent.inventory",
            "severity": "info" if a.get("status") == "active" else "medium",
            "title": f"Agent {agent_name} — {a.get('status', 'unknown')}",
            "message": json.dumps({
                "id": a.get("id"),
                "ip": a.get("ip"),
                "os": os_info,
                "version": a.get("version"),
                "groups": a.get("group", []),
                "node": a.get("node_name"),
                "last_keepalive": a.get("lastKeepAlive"),
                "registered": a.get("dateAdd"),
            }, ensure_ascii=False),
            "fingerprint": f"wazuh:agent:inventory:{a.get('id', agent_name)}",
            "attributes": {
                "agent_id": a.get("id"),
                "agent_name": agent_name,
                "agent_ip": a.get("ip"),
                "agent_status": a.get("status"),
                "os_name": os_name,
                "os_version": os_version,
                "os_platform": os_platform,
                "wazuh_version": a.get("version"),
                "groups": a.get("group", []),
                "node_name": a.get("node_name"),
            },
        })

    log.info("Agents: %d total, statuses: %s", len(agents), status_counts)
    return metrics, events


def collect_sca(wz: WazuhClient, agent_ids: list[str]) -> tuple[list[dict], list[dict]]:
    """Collect SCA (Security Configuration Assessment) results per agent."""
    log.info("Collecting SCA for %d agents...", len(agent_ids))
    ts = _now_iso()
    metrics: list[dict] = []
    events: list[dict] = []

    for aid in agent_ids:
        try:
            policies = wz.get(f"/sca/{aid}")
            items = policies.get("data", {}).get("affected_items", [])
        except Exception as e:
            log.warning("SCA fetch failed for agent %s: %s", aid, e)
            continue

        for pol in items:
            policy_id = pol.get("policy_id", "unknown")
            name = pol.get("name", policy_id)
            score = pol.get("score", 0)
            passed = pol.get("pass", 0)
            failed = pol.get("fail", 0)
            invalid = pol.get("invalid", 0)
            total = pol.get("total_checks", passed + failed + invalid)

            asset_id = f"host:{aid}"

            metrics.append({
                "ts": ts,
                "asset_id": asset_id,
                "namespace": "wazuh",
                "metric": "sca.score",
                "value": score,
                "unit": "percent",
                "dimensions": {"policy": policy_id, "policy_name": name[:100]},
            })
            metrics.append({
                "ts": ts,
                "asset_id": asset_id,
                "namespace": "wazuh",
                "metric": "sca.checks.passed",
                "value": passed,
                "unit": "count",
                "dimensions": {"policy": policy_id},
            })
            metrics.append({
                "ts": ts,
                "asset_id": asset_id,
                "namespace": "wazuh",
                "metric": "sca.checks.failed",
                "value": failed,
                "unit": "count",
                "dimensions": {"policy": policy_id},
            })

            severity = "info" if score >= 80 else ("low" if score >= 60 else ("medium" if score >= 40 else "high"))
            events.append({
                "ts": ts,
                "asset_id": asset_id,
                "namespace": "wazuh",
                "kind": "sca.result",
                "severity": severity,
                "title": f"SCA {name}: {score}% ({passed}/{total} passed)",
                "fingerprint": f"wazuh:sca:{aid}:{policy_id}",
                "attributes": {
                    "agent_id": aid,
                    "policy_id": policy_id,
                    "policy_name": name,
                    "score": score,
                    "passed": passed,
                    "failed": failed,
                    "invalid": invalid,
                    "total_checks": total,
                },
            })

    log.info("SCA: %d metrics, %d events", len(metrics), len(events))
    return metrics, events


def collect_mitre(wz: WazuhClient) -> tuple[list[dict], list[dict]]:
    """Collect MITRE ATT&CK technique/tactic coverage from Wazuh rules."""
    log.info("Collecting MITRE ATT&CK...")
    ts = _now_iso()
    metrics: list[dict] = []
    events: list[dict] = []

    # Techniques
    try:
        techniques = wz.get_all("/mitre/techniques", {"limit": 500})
    except Exception as e:
        log.warning("MITRE techniques fetch failed: %s", e)
        techniques = []

    # Tactics
    try:
        tactics = wz.get_all("/mitre/tactics", {"limit": 500})
    except Exception as e:
        log.warning("MITRE tactics fetch failed: %s", e)
        tactics = []

    # Groups
    try:
        groups = wz.get_all("/mitre/groups", {"limit": 500})
    except Exception as e:
        log.warning("MITRE groups fetch failed: %s", e)
        groups = []

    # Software
    try:
        software = wz.get_all("/mitre/software", {"limit": 500})
    except Exception as e:
        log.warning("MITRE software fetch failed: %s", e)
        software = []

    metrics.append({
        "ts": ts,
        "asset_id": "wazuh:manager",
        "namespace": "wazuh",
        "metric": "mitre.techniques.total",
        "value": len(techniques),
        "unit": "count",
    })
    metrics.append({
        "ts": ts,
        "asset_id": "wazuh:manager",
        "namespace": "wazuh",
        "metric": "mitre.tactics.total",
        "value": len(tactics),
        "unit": "count",
    })
    metrics.append({
        "ts": ts,
        "asset_id": "wazuh:manager",
        "namespace": "wazuh",
        "metric": "mitre.groups.total",
        "value": len(groups),
        "unit": "count",
    })
    metrics.append({
        "ts": ts,
        "asset_id": "wazuh:manager",
        "namespace": "wazuh",
        "metric": "mitre.software.total",
        "value": len(software),
        "unit": "count",
    })

    # Snapshot event with full MITRE catalog
    tactic_list = [{"id": t.get("id"), "name": t.get("name")} for t in tactics]
    technique_summary = [
        {
            "id": t.get("id"),
            "name": t.get("name"),
            "tactics": t.get("tactics") or [],
        }
        for t in techniques[:200]  # cap to avoid oversized events
    ]

    events.append({
        "ts": ts,
        "asset_id": "wazuh:manager",
        "namespace": "wazuh",
        "kind": "mitre.catalog",
        "severity": "info",
        "title": f"MITRE ATT&CK: {len(techniques)} techniques, {len(tactics)} tactics",
        "message": json.dumps({
            "tactics": tactic_list,
            "techniques_count": len(techniques),
            "groups_count": len(groups),
            "software_count": len(software),
        }, ensure_ascii=False),
        "fingerprint": "wazuh:mitre:catalog",
        "attributes": {
            "techniques_count": len(techniques),
            "tactics_count": len(tactics),
            "groups_count": len(groups),
            "software_count": len(software),
            "tactics": tactic_list,
            "techniques_sample": technique_summary[:50],
        },
    })

    log.info("MITRE: %d techniques, %d tactics, %d groups, %d software",
             len(techniques), len(tactics), len(groups), len(software))
    return metrics, events


def collect_syscollector(wz: WazuhClient, agent_ids: list[str]) -> tuple[list[dict], list[dict]]:
    """Collect OS, hardware, and package inventory per agent."""
    log.info("Collecting syscollector for %d agents...", len(agent_ids))
    ts = _now_iso()
    metrics: list[dict] = []
    events: list[dict] = []

    for aid in agent_ids:
        asset_id = f"host:{aid}"

        # OS info
        try:
            os_data = wz.get(f"/syscollector/{aid}/os")
            os_items = os_data.get("data", {}).get("affected_items", [])
            if os_items:
                osi = os_items[0]
                # OS info may be nested: {"os": {"name": ..., "version": ...}}
                os_nested = osi.get("os") or {}
                os_n = os_nested.get("name", "") if isinstance(os_nested, dict) else ""
                os_v = os_nested.get("version", "") if isinstance(os_nested, dict) else ""
                os_p = os_nested.get("platform", osi.get("os_platform", ""))
                events.append({
                    "ts": ts,
                    "asset_id": asset_id,
                    "namespace": "wazuh",
                    "kind": "syscollector.os",
                    "severity": "info",
                    "title": f"OS: {os_n} {os_v}".strip() or "OS: unknown",
                    "fingerprint": f"wazuh:syscollector:os:{aid}",
                    "attributes": {
                        "agent_id": aid,
                        "os_name": os_n,
                        "os_version": os_v,
                        "os_codename": os_nested.get("codename") if isinstance(os_nested, dict) else None,
                        "os_platform": os_p,
                        "architecture": osi.get("architecture"),
                        "hostname": osi.get("hostname"),
                        "kernel_name": osi.get("sysname"),
                        "kernel_release": osi.get("release"),
                        "kernel_version": osi.get("version"),
                    },
                })
        except Exception as e:
            log.warning("Syscollector OS failed for agent %s: %s", aid, e)

        # Hardware
        try:
            hw_data = wz.get(f"/syscollector/{aid}/hardware")
            hw_items = hw_data.get("data", {}).get("affected_items", [])
            if hw_items:
                hw = hw_items[0]
                cpu = hw.get("cpu", {})
                ram_total = hw.get("ram", {}).get("total", 0)

                metrics.append({
                    "ts": ts,
                    "asset_id": asset_id,
                    "namespace": "wazuh",
                    "metric": "syscollector.ram.total_mb",
                    "value": round(ram_total / 1024, 2) if ram_total else 0,
                    "unit": "MB",
                    "dimensions": {"agent_id": aid},
                })
                metrics.append({
                    "ts": ts,
                    "asset_id": asset_id,
                    "namespace": "wazuh",
                    "metric": "syscollector.cpu.cores",
                    "value": cpu.get("cores", 0),
                    "unit": "count",
                    "dimensions": {"agent_id": aid},
                })

                events.append({
                    "ts": ts,
                    "asset_id": asset_id,
                    "namespace": "wazuh",
                    "kind": "syscollector.hardware",
                    "severity": "info",
                    "title": f"HW: {cpu.get('name', 'unknown')} — {cpu.get('cores', '?')} cores, {round(ram_total / 1024)} MB RAM",
                    "fingerprint": f"wazuh:syscollector:hw:{aid}",
                    "attributes": {
                        "agent_id": aid,
                        "cpu_name": cpu.get("name"),
                        "cpu_cores": cpu.get("cores"),
                        "cpu_mhz": cpu.get("mhz"),
                        "ram_total_kb": ram_total,
                        "ram_free_kb": hw.get("ram", {}).get("free"),
                        "ram_usage": hw.get("ram", {}).get("usage"),
                        "board_serial": hw.get("board_serial"),
                    },
                })
        except Exception as e:
            log.warning("Syscollector HW failed for agent %s: %s", aid, e)

        # Packages count (just the total, not all packages)
        try:
            pkg_data = wz.get(f"/syscollector/{aid}/packages", {"limit": 1})
            total_pkgs = pkg_data.get("data", {}).get("total_affected_items", 0)
            metrics.append({
                "ts": ts,
                "asset_id": asset_id,
                "namespace": "wazuh",
                "metric": "syscollector.packages.total",
                "value": total_pkgs,
                "unit": "count",
                "dimensions": {"agent_id": aid},
            })
        except Exception as e:
            log.warning("Syscollector packages failed for agent %s: %s", aid, e)

    log.info("Syscollector: %d metrics, %d events", len(metrics), len(events))
    return metrics, events


def collect_vulnerability(wz: WazuhClient, agent_ids: list[str]) -> tuple[list[dict], list[dict]]:
    """Collect vulnerability scan results per agent (Wazuh 4.3+)."""
    log.info("Collecting vulnerabilities for %d agents...", len(agent_ids))
    ts = _now_iso()
    metrics: list[dict] = []
    events: list[dict] = []

    for aid in agent_ids:
        asset_id = f"host:{aid}"
        try:
            vulns = wz.get_all(f"/vulnerability/{aid}/results", {"limit": 500})
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code == 404:
                log.debug("Vulnerability endpoint not available for agent %s (module may be disabled)", aid)
                continue
            log.warning("Vulnerability fetch failed for agent %s: %s", aid, e)
            continue
        except Exception as e:
            log.warning("Vulnerability fetch failed for agent %s: %s", aid, e)
            continue

        if not vulns:
            continue

        # Severity counts
        sev_counts: dict[str, int] = {}
        for v in vulns:
            sev = (v.get("severity") or "unknown").lower()
            sev_counts[sev] = sev_counts.get(sev, 0) + 1

        metrics.append({
            "ts": ts,
            "asset_id": asset_id,
            "namespace": "wazuh",
            "metric": "vulnerability.total",
            "value": len(vulns),
            "unit": "count",
            "dimensions": {"agent_id": aid},
        })

        for sev, count in sev_counts.items():
            metrics.append({
                "ts": ts,
                "asset_id": asset_id,
                "namespace": "wazuh",
                "metric": f"vulnerability.severity.{sev}",
                "value": count,
                "unit": "count",
                "dimensions": {"agent_id": aid},
            })

        # Critical/High vulns as individual events
        for v in vulns:
            sev = (v.get("severity") or "").lower()
            if sev not in ("critical", "high"):
                continue
            cve = v.get("cve") or v.get("reference") or "unknown"
            orbit_sev = "critical" if sev == "critical" else "high"
            events.append({
                "ts": ts,
                "asset_id": asset_id,
                "namespace": "wazuh",
                "kind": "vulnerability",
                "severity": orbit_sev,
                "title": f"{cve}: {(v.get('name') or v.get('title') or cve)[:150]}",
                "message": v.get("condition") or v.get("rationale"),
                "fingerprint": f"wazuh:vuln:{aid}:{cve}",
                "attributes": {
                    "agent_id": aid,
                    "cve": cve,
                    "severity": sev,
                    "package_name": v.get("name"),
                    "package_version": v.get("version"),
                    "architecture": v.get("architecture"),
                    "status": v.get("status"),
                    "detection_time": v.get("detection_time"),
                },
            })

        # Summary event for agent
        events.append({
            "ts": ts,
            "asset_id": asset_id,
            "namespace": "wazuh",
            "kind": "vulnerability.summary",
            "severity": "high" if sev_counts.get("critical", 0) > 0 else (
                "medium" if sev_counts.get("high", 0) > 0 else "info"
            ),
            "title": f"Vulnerabilities: {len(vulns)} total ({sev_counts})",
            "fingerprint": f"wazuh:vuln:summary:{aid}",
            "attributes": {
                "agent_id": aid,
                "total": len(vulns),
                **{f"severity_{k}": v for k, v in sev_counts.items()},
            },
        })

    log.info("Vulnerabilities: %d metrics, %d events", len(metrics), len(events))
    return metrics, events


def collect_manager_stats(wz: WazuhClient) -> tuple[list[dict], list[dict]]:
    """Collect Wazuh manager statistics."""
    log.info("Collecting manager stats...")
    ts = _now_iso()
    metrics: list[dict] = []

    try:
        stats = wz.get("/manager/stats")
        items = stats.get("data", {}).get("affected_items", [])

        # Manager stats are hourly buckets. Get totals from the most recent.
        total_events = 0
        total_alerts = 0
        total_firewall = 0
        total_syscheck = 0
        for s in items:
            total_events += s.get("events", 0)
            total_alerts += s.get("alerts", [{}])[0].get("sigid", 0) if isinstance(s.get("alerts"), list) else 0
            total_firewall += s.get("firewall", 0)
            total_syscheck += s.get("syscheck", 0)

        metrics.append({
            "ts": ts,
            "asset_id": "wazuh:manager",
            "namespace": "wazuh",
            "metric": "manager.events_today",
            "value": total_events,
            "unit": "count",
        })
        metrics.append({
            "ts": ts,
            "asset_id": "wazuh:manager",
            "namespace": "wazuh",
            "metric": "manager.firewall_today",
            "value": total_firewall,
            "unit": "count",
        })
        metrics.append({
            "ts": ts,
            "asset_id": "wazuh:manager",
            "namespace": "wazuh",
            "metric": "manager.syscheck_today",
            "value": total_syscheck,
            "unit": "count",
        })
    except Exception as e:
        log.warning("Manager stats failed: %s", e)

    # Manager info
    try:
        info = wz.get("/manager/info")
        info_data = info.get("data", {}).get("affected_items", [{}])[0]
        if info_data:
            metrics.append({
                "ts": ts,
                "asset_id": "wazuh:manager",
                "namespace": "wazuh",
                "metric": "manager.uptime_seconds",
                "value": 1,  # marker — actual uptime could be computed from boot time
                "unit": "flag",
                "dimensions": {
                    "version": info_data.get("version", ""),
                    "type": info_data.get("type", ""),
                    "tz_name": info_data.get("tz_name", ""),
                },
            })
    except Exception as e:
        log.warning("Manager info failed: %s", e)

    log.info("Manager stats: %d metrics", len(metrics))
    return metrics, []


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not WAZUH_API_URL:
        log.error("WAZUH_API_URL is required")
        sys.exit(1)
    if not WAZUH_API_PASS:
        log.error("WAZUH_API_PASS is required")
        sys.exit(1)

    wz = WazuhClient(WAZUH_API_URL, WAZUH_API_USER, WAZUH_API_PASS, WAZUH_VERIFY_TLS)
    wz.authenticate()

    orbit = OrbitShipper(ORBIT_API)

    all_metrics: list[dict] = []
    all_events: list[dict] = []

    # 1. Agents — always first (we need agent IDs for other collectors)
    active_agent_ids: list[str] = []
    if COLLECT_AGENTS:
        m, e = collect_agents(wz)
        all_metrics.extend(m)
        all_events.extend(e)

    # Get active agent IDs for per-agent collectors
    try:
        agents = wz.get_all("/agents", {"select": "id,status", "status": "active"})
        active_agent_ids = [a["id"] for a in agents if a.get("id") != "000"]
    except Exception as ex:
        log.warning("Failed to list active agents: %s", ex)

    # 2. SCA
    if COLLECT_SCA and active_agent_ids:
        m, e = collect_sca(wz, active_agent_ids)
        all_metrics.extend(m)
        all_events.extend(e)

    # 3. MITRE ATT&CK
    if COLLECT_MITRE:
        m, e = collect_mitre(wz)
        all_metrics.extend(m)
        all_events.extend(e)

    # 4. Syscollector
    if COLLECT_SYSCOLLECTOR and active_agent_ids:
        m, e = collect_syscollector(wz, active_agent_ids)
        all_metrics.extend(m)
        all_events.extend(e)

    # 5. Vulnerabilities
    if COLLECT_VULN and active_agent_ids:
        m, e = collect_vulnerability(wz, active_agent_ids)
        all_metrics.extend(m)
        all_events.extend(e)

    # 6. Manager stats
    if COLLECT_STATS:
        m, e = collect_manager_stats(wz)
        all_metrics.extend(m)
        all_events.extend(e)

    # Ship to orbit-core
    if all_metrics:
        orbit.ship_metrics(all_metrics)
    if all_events:
        orbit.ship_events(all_events)

    log.info("Done: %d metrics, %d events shipped", len(all_metrics), len(all_events))


if __name__ == "__main__":
    main()
