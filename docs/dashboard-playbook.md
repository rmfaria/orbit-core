# Dashboard Playbook (Orbit)

Guia de padrões e guardrails para criação de dashboards no orbit-core —
seja manualmente no builder, via AI agent, ou programaticamente via API.

## Princípios

- **Nenhum SQL raw** em dashboards gerados.
- Use apenas **OrbitQL** (kind: timeseries / timeseries_multi / events / event_count).
- Prefira **performance-first defaults**:
  - auto-bucket por range (omitir `bucket_sec`)
  - limites conservadores
  - Top‑N ao agrupar por dimensão
- Evite cardinalidade ilimitada.
- Use nomes estáveis e descritivos.

## Convenções de nomenclatura

- Dashboard: `<escopo> — <propósito>` (ex: `Produção — Saúde dos Servidores`)
- Widget: `<métrica> — <breakdown>` (ex: `CPU Load — load1/load5/load15`)

## DashboardSpec — campos obrigatórios

```json
{
  "id": "dash-1234567890",
  "name": "Nome do Dashboard",
  "version": "v1",
  "time": { "preset": "24h" },
  "tags": [],
  "widgets": [...]
}
```

Presets de tempo: `60m` | `6h` | `24h` | `7d` | `30d`

## Widgets — tipos e queries

### `timeseries` (span=1)

Série temporal única. **Obrigatório: `asset_id`.**
O `kind` na query deve ser `"timeseries"`.

```json
{
  "kind": "timeseries",
  "asset_id": "host:servidor1",
  "namespace": "nagios",
  "metric": "load1"
}
```

### `timeseries_multi` (span=2)

Múltiplas séries. **Obrigatório: `series` array com `asset_id` em cada entrada.**

```json
{
  "kind": "timeseries_multi",
  "series": [
    { "asset_id": "host:srv1", "namespace": "nagios", "metric": "load1", "label": "srv1" },
    { "asset_id": "host:srv2", "namespace": "nagios", "metric": "load1", "label": "srv2" }
  ]
}
```

### `kpi` (span=1)

Valor instantâneo (último ponto da série). Usa query `timeseries` — **obrigatório: `asset_id`.**

```json
{
  "kind": "timeseries",
  "asset_id": "host:servidor1",
  "namespace": "nagios",
  "metric": "memory_used"
}
```

### `events` (span=1 ou 2)

Feed de eventos filtrado. O `kind` na query deve ser `"events"`.

```json
{ "kind": "events", "namespace": "wazuh", "limit": 20 }
{ "kind": "events", "namespace": "wazuh", "severities": ["high", "critical"], "limit": 50 }
{ "kind": "events", "namespace": "wazuh", "asset_id": "host:servidor1", "limit": 20 }
{ "kind": "events", "namespace": "wazuh", "kinds": ["authentication_failed"], "limit": 20 }
```

### `eps` (span=2)

Gráfico EPS (eventos/segundo). O `kind` na query deve ser `"event_count"`.

```json
{ "kind": "event_count", "namespace": "wazuh" }
{ "kind": "event_count", "namespace": "wazuh", "asset_id": "host:servidor1" }
```

**Importante:** a query dos widgets **não deve conter `from` / `to`** — esses campos
são injetados em runtime pelo renderer baseado em `time.preset` do dashboard.

## Padrões de widget por caso de uso

### Monitoramento de servidor (Nagios)

| Widget | Kind | Query |
|--------|------|-------|
| CPU Load | `timeseries_multi` | metric=load1, series com todos os hosts |
| Memória Usada | `timeseries` | metric=memory_used, asset_id=host específico |
| Disco | `timeseries_multi` | metric=size ou metric=procs |
| Disponibilidade | `kpi` | metric=rta, asset_id=host |

### Segurança Wazuh

| Widget | Kind | Observação |
|--------|------|------------|
| EPS Global | `eps` | namespace=wazuh, span=2 |
| EPS por Agente | `eps` | namespace=wazuh, asset_id=host:X |
| Feed Crítico | `events` | severities=["high","critical"], span=2 |
| Feed por Agente | `events` | asset_id=host:X |
| Fortigate | `events` | kinds=["fortigate"], span=2 |

### Automação n8n

| Widget | Kind | Query |
|--------|------|-------|
| Falhas | `events` | namespace=n8n, kinds=["execution_error"] |
| Travados | `events` | namespace=n8n, kinds=["execution_stuck"] |

## Limites recomendados

| Parâmetro | Padrão | Máximo |
|-----------|--------|--------|
| `limit` (events) | 20 | 200 por widget |
| `top_n` | 20 | 50 |
| Widgets por dashboard | — | 60 |
| Range de tempo | 24h | 30d |

## Uso do AI Agent

1. Configurar `ai_api_key` (Anthropic) e `ai_model` em **Admin → AI Agent**
2. Ir em **Dashboards → Criar Dashboard**
3. Descrever o dashboard em linguagem natural:
   > "quero monitorar CPU e memória dos servidores nagios e ver o EPS do wazuh com alertas críticos"
4. Clicar **⚡ Gerar com IA**
5. Revisar os widgets gerados no builder — editar se necessário
6. Clicar **Salvar**

O AI agent consulta o catálogo real do banco (métricas por ativo, namespaces de eventos,
kinds, agents, severities) e usa apenas fontes de dados existentes.

## Validação via API

```bash
curl -s -X POST https://prod.example.com/orbit-core/api/v1/dashboards/validate \
  -H "X-Api-Key: <chave>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-dash",
    "name": "Teste",
    "version": "v1",
    "time": {"preset": "24h"},
    "tags": [],
    "widgets": [...]
  }'
```

Retorna `{ ok: true, spec: ... }` se válido, ou `{ ok: false, error: ... }` com detalhes.
