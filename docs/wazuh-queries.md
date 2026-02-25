# Wazuh query examples (orbit-core)

These are practical examples for querying Wazuh-derived events stored in orbit-core.

All examples assume:
- API base: `https://prod.example.com/orbit-core/api/v1`
- auth header: `X-Api-Key: <your-key>`

## Authentication

```bash
export ORBIT_API_BASE='https://prod.example.com/orbit-core/api/v1'
export ORBIT_API_KEY='...'
```

Helper:

```bash
orbit_query () {
  curl -sS "$ORBIT_API_BASE/query" \
    -H "X-Api-Key: $ORBIT_API_KEY" \
    -H 'Content-Type: application/json' \
    -d "$1"
}
```

## 1) Latest alerts (any severity)

```bash
orbit_query '{
  "kind": "events",
  "namespace": "wazuh",
  "from": "2026-02-24T00:00:00Z",
  "to":   "2026-02-25T00:00:00Z",
  "limit": 50
}'
```

## 2) High + critical alerts

```bash
orbit_query '{
  "kind": "events",
  "namespace": "wazuh",
  "from": "2026-02-24T00:00:00Z",
  "to":   "2026-02-25T00:00:00Z",
  "severities": ["high", "critical"],
  "limit": 100
}'
```

## 3) Alerts for a single agent/asset

```bash
orbit_query '{
  "kind": "events",
  "namespace": "wazuh",
  "asset_id": "host:vm002",
  "from": "2026-02-24T00:00:00Z",
  "to":   "2026-02-25T00:00:00Z",
  "limit": 100
}'
```

## 4) Fortigate (via Wazuh)

Fortigate events are emitted as `namespace=wazuh` and `kind=fortigate`.

```bash
orbit_query '{
  "kind": "events",
  "namespace": "wazuh",
  "kinds": ["fortigate"],
  "from": "2026-02-24T00:00:00Z",
  "to":   "2026-02-25T00:00:00Z",
  "limit": 200
}'
```

## 5) EPS — events per second (last 1h, 1-minute buckets)

```bash
orbit_query '{
  "kind": "event_count",
  "namespace": "wazuh",
  "from": "2026-02-24T23:00:00Z",
  "to":   "2026-02-25T00:00:00Z",
  "bucket_sec": 60
}'
```

## 6) EPS — automatic bucket selection

If `bucket_sec` is omitted, orbit-core may choose it based on the requested time range.

```bash
orbit_query '{
  "kind": "event_count",
  "namespace": "wazuh",
  "from": "2026-02-20T00:00:00Z",
  "to":   "2026-02-25T00:00:00Z"
}'
```

## 7) AI dashboard generation (if enabled)

```bash
curl -sS "$ORBIT_API_BASE/ai/dashboard" \
  -H "X-Api-Key: $ORBIT_API_KEY" \
  -H "X-Ai-Key: $ANTHROPIC_KEY" \
  -H "X-Ai-Model: claude-sonnet-4-6" \
  -H 'Content-Type: application/json' \
  -d '{ "prompt": "Security dashboard with global EPS, critical alerts and per-agent feed" }'
```

Returns `{ ok: true, spec: DashboardSpec }`.

## 8) Events catalog (namespaces, kinds, agents, severities)

```bash
curl -sS "$ORBIT_API_BASE/catalog/events" \
  -H "X-Api-Key: $ORBIT_API_KEY"
```

## Severity mapping (Wazuh rule.level)

| level | severity |
|---:|---|
| 0–3 | `info` |
| 4–6 | `low` |
| 7–10 | `medium` |
| 11–13 | `high` |
| 14–15 | `critical` |
