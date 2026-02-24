# Orbit Core – Product Doc

Atualizado: 2026-02-24

## Problema

Equipes de segurança e operações precisam monitorar múltiplas fontes de telemetria
(Nagios, Wazuh, Fortigate, n8n) num único painel, com dashboards personalizados,
feed de eventos ao vivo e a capacidade de gerar visualizações a partir de descrições
em linguagem natural.

## Usuários-alvo

- Analistas SOC
- Engenheiros de detecção
- Engenheiros de plataforma operando Wazuh / Nagios
- Times DevOps monitorando automações n8n

## Funcionalidades implementadas

### Ingestão e armazenamento

- `POST /api/v1/ingest/metrics` — métricas em batch (série temporal com dimensões JSONB)
- `POST /api/v1/ingest/events` — eventos em batch (namespace, kind, severity, title, message, fingerprint)
- Rollups automáticos: RAW → 5m → 1h, com retenção configurável
- Seleção automática de tabela RAW / rollup baseada no range da query

### Conectores

| Conector | Dados | Namespace | Modo |
|----------|-------|-----------|------|
| Nagios | métricas perfdata + eventos HARD state change | `nagios` | cron (arquivo) |
| Wazuh | alertas de segurança | `wazuh` | cron (arquivo / OpenSearch) |
| Fortigate | logs de firewall | `wazuh` / `kind=fortigate` | via Wazuh syslog |
| n8n | falhas e execuções travadas | `n8n` | cron + Error Trigger |

### Query engine (OrbitQL)

- `timeseries` — série temporal com auto-bucket e rollup transparente
- `timeseries_multi` — múltiplas séries com group_by_dimension opcional
- `events` — busca filtrada por namespace, kind, severity, asset_id
- `event_count` — contagem de eventos/segundo (EPS) com bucket automático

### Dashboard Builder

- Dashboards salvos em Postgres como JSONB
- 5 tipos de widget: `timeseries`, `timeseries_multi`, `events`, `eps`, `kpi`
- Layout em grid (span 1 = metade, span 2 = inteiro)
- Preset de tempo: 60m / 6h / 24h / 7d / 30d
- Modo rotação (slideshow) com intervalo configurável (15s / 30s / 1min / 5min)

### AI Agent (Dashboard Builder)

- `POST /api/v1/ai/dashboard` — gera DashboardSpec via Claude (Anthropic)
- Consulta catálogo real: métricas por ativo, namespaces de eventos, kinds, agents, severities
- System prompt com catálogo estruturado + guia Wazuh + regras de validação
- Headers: `X-Ai-Key` (chave Anthropic), `X-Ai-Model` (ex: `claude-sonnet-4-6`)
- Configuração da chave no Admin da UI, armazenada em `localStorage`

### UI — Abas

| Aba | Conteúdo |
|-----|----------|
| **Home** | KPIs, gráficos, EPS Wazuh, live feed |
| **Dashboards** | List / Builder / View + rotação |
| **Métricas** | Query builder livre |
| **Eventos** | Feed filtrado |
| **Correlações** | Correlações automáticas |
| **Nagios / Wazuh / Fortigate / n8n** | Abas dedicadas por fonte |
| **Admin** | API Key + AI Agent config |

### Catálogo

- `GET /api/v1/catalog/assets` — ativos com filtro por nome
- `GET /api/v1/catalog/metrics` — métricas por ativo (namespace, metric, points, last_ts)
- `GET /api/v1/catalog/dimensions` — valores de dimensões
- `GET /api/v1/catalog/events` — namespaces de eventos com kinds, agents e severities

### Segurança

- `ORBIT_API_KEY` obrigatório em produção (`X-Api-Key` header)
- BasicAuth como fallback de compatibilidade
- Nenhum SQL raw exposto; todas as queries via OrbitQL (parâmetros seguros)

## Critérios de qualidade

- Setup local em < 5 minutos (excluindo Postgres)
- Queries retornam em < 2s para datasets típicos
- AI gera dashboards válidos com fontes reais em uma chamada
- Deploy via script único (`deploy.sh`) com health check ao final

## Roadmap (próximas versões)

- Multi-tenant (namespaces isolados por cliente)
- Alertas automáticos baseados em thresholds
- Armazenamento ClickHouse para volumes maiores
- Agendamento de relatórios por e-mail
- RBAC (roles por fonte / dashboard)
