# Wazuh — Query Examples (OrbitQL)

Exemplos de queries para o namespace `wazuh` via `POST /api/v1/query`.

## Autenticação

```bash
# API Key (recomendado)
-H "X-Api-Key: <sua-chave>"

# BasicAuth (legado)
-u orbitadmin:PASS
```

---

## 1) Últimos alertas (qualquer severidade)

```bash
curl -s -H "X-Api-Key: <chave>" \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "kind": "events",
      "namespace": "wazuh",
      "from": "'"$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)"'",
      "to":   "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "limit": 50
    }
  }'
```

## 2) Alertas de alta/crítica severidade

```json
{
  "query": {
    "kind": "events",
    "namespace": "wazuh",
    "from": "2026-02-24T00:00:00Z",
    "to":   "2026-02-25T00:00:00Z",
    "severities": ["high", "critical"],
    "limit": 100
  }
}
```

## 3) Alertas de um agente específico

```json
{
  "query": {
    "kind": "events",
    "namespace": "wazuh",
    "asset_id": "host:meu-servidor",
    "from": "2026-02-24T00:00:00Z",
    "to":   "2026-02-25T00:00:00Z",
    "limit": 200
  }
}
```

## 4) Apenas eventos Fortigate (via Wazuh)

```json
{
  "query": {
    "kind": "events",
    "namespace": "wazuh",
    "kinds": ["fortigate"],
    "from": "2026-02-24T00:00:00Z",
    "to":   "2026-02-25T00:00:00Z",
    "limit": 100
  }
}
```

## 5) EPS — Eventos por segundo (último 1h, bucket de 1 min)

```json
{
  "query": {
    "kind": "event_count",
    "namespace": "wazuh",
    "from": "2026-02-24T11:00:00Z",
    "to":   "2026-02-24T12:00:00Z",
    "bucket_sec": 60
  }
}
```

Resposta:
```json
{
  "ok": true,
  "result": {
    "columns": [{"name": "ts", "type": "timestamptz"}, {"name": "value", "type": "float8"}],
    "rows": [
      {"ts": "2026-02-24T11:00:00Z", "value": 2.5},
      {"ts": "2026-02-24T11:01:00Z", "value": 1.8},
      ...
    ]
  },
  "meta": {"effective_bucket_sec": 60}
}
```

`value` = eventos por segundo (count / bucket_sec).

## 6) EPS — seleção automática de bucket

Omitir `bucket_sec` — o backend seleciona automaticamente com base no range:

```json
{
  "query": {
    "kind": "event_count",
    "namespace": "wazuh",
    "from": "2026-02-17T00:00:00Z",
    "to":   "2026-02-24T00:00:00Z"
  }
}
```

## 7) Dashboard via AI Agent

Gerar um DashboardSpec com widgets Wazuh via Claude:

```bash
curl -s -X POST https://prod.example.com/orbit-core/api/v1/ai/dashboard \
  -H "X-Api-Key: <orbit-chave>" \
  -H "X-Ai-Key: <anthropic-chave>" \
  -H "X-Ai-Model: claude-sonnet-4-6" \
  -H "Content-Type: application/json" \
  -d '{ "prompt": "dashboard de segurança com EPS global, alertas críticos e feed por agente" }'
```

Retorna `{ ok: true, spec: DashboardSpec }` com widgets gerados a partir do catálogo real.

## 8) Catálogo de eventos (namespaces, kinds, agents, severities)

```bash
curl -s -H "X-Api-Key: <chave>" \
  https://prod.example.com/orbit-core/api/v1/catalog/events
```

Resposta:
```json
{
  "ok": true,
  "namespaces": [
    {
      "namespace": "wazuh",
      "total": 125000,
      "last_seen": "2026-02-24T19:00:00Z",
      "kinds": ["authentication_failed", "syslog", "fortigate"],
      "agents": ["host:wazuh-gm-sec", "host:wazuh-sec-ne"],
      "severities": ["critical", "high", "medium", "low", "info"]
    }
  ]
}
```

---

## Mapeamento de campos

| Campo orbit-core | Origem no alerta Wazuh |
|-----------------|------------------------|
| `ts` | `timestamp` |
| `asset_id` | `host:<agent.name>` |
| `namespace` | `"wazuh"` (fixo) |
| `kind` | `rule.groups[0]` |
| `severity` | mapeado de `rule.level` (0–15) |
| `title` | `rule.description` |
| `message` | `full_log` |
| `fingerprint` | `agent.id:rule.id:alert.id` |
| `attributes` | `rule.*`, `agent.*`, `data.*` |

**Severidade por nível:**

| Level | Severity |
|-------|---------|
| 0–3 | `info` |
| 4–6 | `low` |
| 7–10 | `medium` |
| 11–13 | `high` |
| 14–15 | `critical` |
