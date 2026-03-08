# Google Ads — Campanha Global orbit-core

## Parte 1: Análise do Produto e Mercado Global

### Produto
orbit-core é uma plataforma self-hosted de telemetria unificada (métricas + eventos + segurança) com dois diferenciais únicos:
- **AI Connector Generator**: descreve qualquer API em linguagem natural → IA gera conector completo
- **AI Designer**: descreve um dashboard em linguagem natural → IA gera página funcional com dados reais

### Modelo de conversão
- **Licença gratuita** via registro em orbit-core.org/register.html (email obrigatório)
- Barreira de entrada mínima: ~10 segundos para registrar
- Conversão = preenchimento do formulário de registro (lead capture)
- Tracking: Google Ads conversion tag já instalado no register.html

### Público-alvo global
| Perfil | Dor principal | Onde estão |
|---|---|---|
| DevOps / SRE | Tool sprawl — Prometheus + Grafana + Loki + Alertmanager fragmentados | Global, concentrados em hubs tech |
| Engenheiro de Segurança | Custo de SIEMs comerciais, fontes heterogêneas | Europa (regulação), Israel, SEA |
| Sysadmin / Infra | Complexidade de manter stack de monitoramento | Europa, LATAM, Índia |
| CTO / Tech Lead (PME) | Custo de Datadog/Splunk, vendor lock-in, soberania de dados | **Europa** (GDPR/NIS2 drivers) |

### Tese central: Europa é o mercado primário

Dados que sustentam:
- **69% das organizações europeias** gerenciam observabilidade on-premise (Grafana Survey 2025)
- **GDPR, NIS2, DORA, CSRD** → regulação empurra para soluções self-hosted com soberania de dados
- CPC **30-57% mais barato** que US para keywords B2B SaaS
- **Alta proficiência em inglês** no norte/oeste europeu (NL, Nordics, DE, IL)
- orbit-core é exatamente o que esse mercado busca: self-hosted, open source, sem vendor lock-in

### Mercado de DevOps global: $16B (2025) → $51B (2031)

| Região | Market share | CAGR | Oportunidade para orbit-core |
|---|---|---|---|
| North America | 37.8% ($6.1B) | 18% | CPC alto demais para budget limitado — competir via orgânico |
| **Europe** | **25.2% ($4.1B)** | **19%** | **Melhor ROI: alta demanda self-hosted + CPC acessível** |
| Asia-Pacific | Crescente | **25.4%** | Índia/Singapore: volume alto, CPC baixo, bom para testes |

### CPC por país (B2B SaaS, estimado)

| País | CPC vs US | CPC estimado | Tier |
|---|---|---|---|
| Índia | -77% | ~$1.00-1.25 | Muito baixo |
| Singapura | -58% | ~$2.25 | Baixo |
| Holanda | -56% | ~$2.35 | Baixo |
| Israel | -55% | ~$2.40 | Baixo |
| Dinamarca | -57% | ~$2.30 | Baixo |
| Suécia | -49% | ~$2.70 | Médio |
| Japão | -47% | ~$2.80 | Médio |
| Alemanha | -31% | ~$3.65 | Médio-alto |
| Canadá | -29% | ~$3.80 | Médio-alto |
| UK | -13% | ~$4.60 | Alto |
| Austrália | -5% | ~$5.10 | Alto |
| **USA** | **baseline** | **~$5.34** | **Muito alto — evitar** |

---

## Parte 2: Análise e Validação de Keywords

### Cluster 1 — Alternativas (alta intenção comercial)

| Keyword | Volume | CPC estimado (EU) | Aceitação Google |
|---|---|---|---|
| `datadog alternative` | Alto | $3-8 | Aprovado (não usar marca no ad copy) |
| `grafana alternative` | Alto | $2-6 | Aprovado |
| `prometheus alternative` | Médio-alto | $2-5 | Aprovado |
| `splunk alternative` | Alto | $3-8 | Aprovado |
| `zabbix alternative` | Médio | $1.50-4 | Aprovado |
| `new relic alternative` | Médio | $2-5 | Aprovado |
| `nagios alternative` | Médio | $1.50-3 | Aprovado |
| `datadog alternative self hosted` | Baixo-médio | $2-5 | Aprovado — alta conversão |
| `grafana alternative self hosted` | Baixo | $1.50-4 | Aprovado — alta conversão |

**Risco**: Trademark complaint pode restringir uso da marca no **ad copy**. Keyword permanece permitida.
**Mitigação**: Nunca citar concorrente no headline. Usar "Looking for a Better Monitoring Solution?" ou "Open Source Alternative".

### Cluster 2 — Self-hosted / Soberania (diferencial Europa)

| Keyword | Volume | CPC estimado (EU) | Aceitação |
|---|---|---|---|
| `self hosted monitoring` | Médio | $1.50-4 | Aprovado |
| `self hosted observability` | Baixo-médio | $1.50-3.50 | Aprovado |
| `on premise monitoring solution` | Médio | $2-5 | Aprovado |
| `GDPR compliant monitoring` | Baixo | $1.50-3 | Aprovado |
| `data sovereignty monitoring` | Muito baixo | $1-2.50 | Aprovado |
| `observability platform on premise` | Baixo | $2-4 | Aprovado |

**Nota**: Keywords de soberania têm volume baixo mas **altíssima intenção** e **zero concorrência**. Ideal para Europa.

### Cluster 3 — Solução / Plataforma (intenção média-alta)

| Keyword | Volume | CPC estimado (EU) | Aceitação |
|---|---|---|---|
| `open source observability` | Médio | $2-5 | Aprovado |
| `open source monitoring tool` | Alto | $2-5 | Aprovado |
| `infrastructure monitoring tool` | Alto | $3-7 | Aprovado |
| `unified observability platform` | Médio | $3-7 | Aprovado |
| `telemetry platform` | Baixo-médio | $2-4 | Aprovado |
| `opentelemetry backend` | Baixo | $1.50-3 | Aprovado |
| `metrics and events platform` | Baixo | $2-4 | Aprovado |
| `server monitoring open source` | Médio | $2-4 | Aprovado |

### Cluster 4 — IA + Segurança (diferencial único)

| Keyword | Volume | CPC estimado (EU) | Aceitação |
|---|---|---|---|
| `ai monitoring tool` | Crescente | $2-5 | Aprovado |
| `ai powered observability` | Baixo | $1.50-4 | Aprovado |
| `ai infrastructure monitoring` | Baixo | $2-5 | Aprovado |
| `ai dashboard generator` | Muito baixo | $1-3 | Aprovado |
| `open source SIEM alternative` | Alto | $3-8 | Aprovado (review extra) |
| `security monitoring open source` | Médio | $2-5 | Aprovado |
| `ai connector generator` | Muito baixo | $1-2 | Aprovado |

**Nota**: Volume baixo mas CPC barato e **zero concorrência**. orbit-core é literalmente o único produto com esse diferencial.

**Risco keywords de segurança**: Podem acionar verificação de "Malicious/Unwanted Software".
**Status orbit-core.org**: HTTPS ativo, sem auto-downloads, sem redirects — **sem risco**.

### Keywords negativas (obrigatório)

```
tutorial, how to, what is, definition, course, certification, salary,
job, jobs, career, interview, download crack, torrent, cheap, DIY,
student, homework, pricing comparison, review, reddit, stackoverflow,
youtube, github, grafana tutorial, prometheus tutorial, zabbix download,
install grafana, install prometheus, install zabbix, nagios download,
splunk free, datadog pricing, grafana pricing, new relic pricing,
learning, training, documentation, docs, wiki, blog
```

**Impacto**: Sem negativas adequadas, **30-40% do budget é desperdiçado** em cliques irrelevantes.

---

## Parte 3: Plano da Campanha Global

### Estratégia geográfica em 3 tiers

| Tier | Países | Budget share | Por quê |
|---|---|---|---|
| **Tier 1 (60%)** | Alemanha, Holanda, Dinamarca, Suécia, Noruega, Finlândia, Israel | $18/dia | Self-hosted culture, GDPR drivers, EN proficiency, CPC $2-4 |
| **Tier 2 (25%)** | Singapura, Brasil, Canadá, Polônia, Suíça | $7.50/dia | CPC acessível, mercados em crescimento, hubs regionais |
| **Tier 3 (15%)** | Índia | $4.50/dia | Volume alto, CPC ~$1, bom para awareness e dados |

**Países excluídos deliberadamente:**
- **USA**: CPC $5.34+ consome budget em 2 dias. Competir via SEO/orgânico.
- **UK**: CPC $4.60, muito competitivo para o budget.
- **Austrália**: CPC próximo do US, mercado pequeno.
- **Japão**: Barreira linguística (sem localização JP).
- **França**: Preferência por conteúdo em francês, friction com produto EN-only.

### Estrutura: 1 campanha, 4 ad groups

**Nome**: `orbit-core — Global Search`
**Tipo**: Search (apenas rede de pesquisa)
**Budget total**: $30/dia (~$900/mês)
**Bidding**: Manual CPC → Target CPA após 30+ conversões
**Schedule**: Seg-Sex, 7h-20h (fuso local do target)
**Devices**: Todos (ajuste +20% desktop)
**Languages**: English (todos), Português (BR ad group)

---

### Ad Group 1: Europe — Data Sovereignty
**Budget share**: 35% (~$10.50/dia)
**Geo**: DE, NL, DK, SE, NO, FI, CH, AT, PL
**Match**: Phrase match

**Keywords**:
```
"self hosted monitoring"
"self hosted observability"
"on premise monitoring solution"
"GDPR compliant monitoring"
"open source observability platform"
"datadog alternative self hosted"
"grafana alternative self hosted"
"data sovereignty monitoring"
"observability platform on premise"
"self hosted telemetry"
```

**Responsive Search Ad**:

Headlines (15):
1. Self-Hosted Observability Platform
2. Your Data. Your Infrastructure
3. GDPR-Ready Monitoring Solution
4. No Vendor Lock-In. No Cloud Fees
5. AI Generates Connectors For You
6. Metrics + Events + Security Unified
7. Free License — Register in 10s
8. Replace Prometheus + Grafana Stack
9. Docker Compose Up — Done
10. Data Sovereignty by Design
11. PostgreSQL-Backed. API-First
12. OpenTelemetry OTLP Native
13. AI Dashboard Designer Built-In
14. Open Source. Apache 2.0
15. Zero Data Leaves Your Network

Descriptions (4):
1. orbit-core runs entirely on your infrastructure. Unify metrics, events and security data behind one API. Your data never leaves your network. Free forever.
2. European teams choose self-hosted observability. orbit-core replaces Prometheus + Grafana + Alertmanager with a single docker compose up. No cloud dependency.
3. AI generates connectors for any HTTP API and dashboards from plain text. Built-in anomaly correlation, SMTP alerts and OpenTelemetry support. Open source.
4. Self-hosted telemetry with full data sovereignty. PostgreSQL-backed, API-first, and production-ready. No per-host pricing, no per-GB fees. Register in 10 seconds.

**Sitelinks**:
- "Get Free License" → orbit-core.org/register.html
- "View Architecture" → orbit-core.org/#flow
- "GitHub (Apache 2.0)" → github.com/rmfaria/orbit-core
- "Quick Start — 5 min" → github.com/rmfaria/orbit-core#-quick-start

---

### Ad Group 2: Global — Alternatives
**Budget share**: 25% (~$7.50/dia)
**Geo**: Tier 1 + Tier 2 (excl. BR e Índia)
**Match**: Phrase match

**Keywords**:
```
"datadog alternative"
"grafana alternative"
"prometheus alternative"
"splunk alternative"
"zabbix alternative"
"new relic alternative"
"nagios alternative"
"open source monitoring alternative"
"infrastructure monitoring tool"
"unified observability platform"
```

**Responsive Search Ad**:

Headlines (15):
1. Open Source Monitoring Alternative
2. Self-Hosted Telemetry Platform
3. AI-Powered Observability Core
4. Stop Paying Per Host
5. Free Forever. No Credit Card
6. AI Builds Connectors For You
7. One Platform. All Your Telemetry
8. Metrics + Events in One Place
9. Docker Deploy in 5 Minutes
10. Built-In AI Dashboard Designer
11. Replace Your Fragmented Stack
12. OpenTelemetry Native Support
13. Smart Alerts: Email + Telegram
14. Auto-Correlation Engine Built-In
15. PostgreSQL-Backed. API-First

Descriptions (4):
1. orbit-core unifies metrics, events and security data in one self-hosted platform. AI generates connectors and dashboards from plain text. Free forever.
2. Stop juggling Prometheus + Grafana + Loki + Alertmanager. One docker compose up replaces them all. Open source, PostgreSQL-backed, API-first.
3. Describe any HTTP API and the AI builds the connector. Describe a dashboard and it generates a live page with your real data. No code needed.
4. Self-hosted telemetry with AI-powered connectors, real-time alerts (email, Telegram, webhook), auto-correlation and smart dashboards. Register in 10 seconds.

---

### Ad Group 3: AI + Security
**Budget share**: 15% (~$4.50/dia)
**Geo**: Tier 1 + Tier 2 + IL

**Keywords**:
```
"ai monitoring tool"
"ai powered observability"
"ai infrastructure monitoring"
"ai dashboard generator"
"ai connector generator"
"open source SIEM alternative"
"security monitoring open source"
"wazuh dashboard"
"suricata monitoring"
```

**Responsive Search Ad**:

Headlines (15):
1. AI-Powered Monitoring Platform
2. AI Generates Connectors — No Code
3. Describe a Dashboard. AI Builds It
4. Security + Metrics in One Platform
5. Open Source SIEM Alternative
6. Wazuh + Suricata + Nagios Unified
7. Free License — No Credit Card
8. Z-Score Anomaly Detection Built-In
9. Auto-Correlation: Metrics to Events
10. Smart Dashboards from Plain Text
11. Self-Hosted Security Telemetry
12. OTLP/HTTP Native Receiver
13. Alerts: Email + Telegram + Webhook
14. Apache 2.0. Your Data. Your Infra
15. AI Writes Integrations For You

Descriptions (4):
1. orbit-core uses AI to generate connectors for any HTTP API and dashboards from natural language. Unify security events and metrics in one self-hosted platform.
2. Built-in anomaly detection links metric spikes to security events automatically. Ingest from Wazuh, Suricata, Nagios or any source. Free and open source.
3. Stop writing custom integrations. Describe any API and the AI produces connector spec + agent script + docs. Approve in one click — data flows automatically.
4. Self-hosted security telemetry with AI-powered features. Z-score correlation, SMTP alerts, smart dashboards and OpenTelemetry support. Free forever.

---

### Ad Group 4: India + Volume
**Budget share**: 15% (~$4.50/dia)
**Geo**: Índia, Singapura
**Match**: Phrase match

**Keywords**:
```
"open source monitoring tool"
"self hosted monitoring"
"infrastructure monitoring open source"
"server monitoring software"
"telemetry platform"
"observability platform"
"datadog alternative free"
"grafana alternative open source"
"open source SIEM"
"monitoring tool for devops"
```

**Responsive Search Ad**:

Headlines (15):
1. Free Monitoring Platform — Open Source
2. Self-Hosted Observability Tool
3. AI Generates Connectors For You
4. Metrics + Events + Security Unified
5. No Per-Host Pricing. Free Forever
6. Docker Compose Up — Running in 5min
7. OpenTelemetry Native Platform
8. Built-In AI Dashboard Builder
9. Replace Prometheus + Grafana
10. PostgreSQL-Backed. API-First
11. Wazuh + Nagios + Suricata Support
12. Auto-Correlation Engine Included
13. Smart Alerts: Email + Telegram
14. Apache 2.0 License
15. Register in 10 Seconds — Free

Descriptions (4):
1. orbit-core: free, self-hosted observability that unifies metrics, events and security data. AI generates connectors from plain text. No vendor lock-in.
2. Replace your fragmented monitoring stack with a single docker compose up. PostgreSQL-backed, OpenTelemetry native, with built-in AI dashboard builder.
3. Ingest data from any source — Nagios, Wazuh, Suricata, or any HTTP API. AI writes the connector for you. Anomaly correlation included. 100% free.
4. Open source telemetry platform with AI-powered connectors, real-time alerts and smart dashboards. Self-hosted, production-ready, Apache 2.0.

---

### Ad Group 5: Brasil (PT-BR)
**Budget share**: 10% (~$3/dia)
**Geo**: Brasil
**Idioma**: Português

**Keywords**:
```
"alternativa ao zabbix"
"alternativa ao datadog"
"alternativa ao grafana"
"monitoramento de infraestrutura"
"ferramenta de monitoramento open source"
"plataforma de observabilidade"
"SIEM open source"
"monitoramento open source"
"monitoramento auto hospedado"
```

**Responsive Search Ad**:

Headlines (15):
1. Observabilidade Open Source com IA
2. Alternativa Self-Hosted ao Datadog
3. Métricas + Eventos + Segurança
4. IA Gera Conectores Automaticamente
5. Licença Gratuita — Cadastre em 10s
6. Sem Vendor Lock-In. Sem Custo por GB
7. Deploy com Docker em 5 Minutos
8. Conectores para Zabbix, Nagios, Wazuh
9. Dashboard por IA: Descreva e Pronto
10. Alertas por Email, Telegram e Webhook
11. PostgreSQL + OpenTelemetry Nativo
12. Substitua sua Stack Fragmentada
13. Correlação de Anomalias Automática
14. API-First. Código Aberto. Apache 2.0
15. Seus Dados na Sua Infraestrutura

Descriptions (4):
1. orbit-core unifica métricas, eventos e segurança em uma plataforma self-hosted. IA gera conectores e dashboards a partir de texto. Licença gratuita para sempre.
2. Pare de manter Prometheus + Grafana + Loki + Alertmanager separados. Um docker compose up substitui tudo. Open source, PostgreSQL, API-first.
3. Descreva qualquer API HTTP e a IA cria o conector. Descreva um dashboard e ele gera uma página com seus dados reais. Sem código.
4. Monitoramento self-hosted com conectores IA, alertas em tempo real (email, Telegram, webhook), correlação automática e dashboards inteligentes.

---

## Conversão e Tracking

### Ação de conversão
- **Tipo**: Envio de formulário em `orbit-core.org/register.html`
- **Tag**: gtag conversion já presente no register.html (success screen)
- **Valor**: Atribuir $5 por conversão (valor estimado de lead)
- **Janela**: 30 dias click-through, 7 dias view-through

### Métricas de sucesso (primeiras 4 semanas)

| Métrica | Meta Tier 1 (EU) | Meta Tier 2 | Meta Tier 3 (IN) |
|---|---|---|---|
| CTR | > 3.5% | > 3% | > 2.5% |
| CPC médio | < $3.50 | < $2.50 | < $1.50 |
| Taxa de conversão | > 5% | > 4% | > 3% |
| Custo por conversão | < $25 | < $20 | < $15 |

**Meta global**: 60+ registros/mês com $900 de budget

### Estimativa de clicks e conversões por tier

| Tier | Budget/mês | CPC médio | Clicks/mês | Conv. 4% | Conv. 5% |
|---|---|---|---|---|---|
| Tier 1 (EU) | $540 | $3.00 | ~180 | 7 | 9 |
| Tier 2 (APAC+BR) | $225 | $2.00 | ~112 | 4 | 6 |
| Tier 3 (IN) | $135 | $1.25 | ~108 | 4 | 5 |
| **Total** | **$900** | **$2.25** | **~400** | **15** | **20** |

**Cenário otimista** (CTR 4%, conversão 6%): 24 registros/mês
**Cenário pessimista** (CTR 2.5%, conversão 3%): 12 registros/mês

### Otimização

| Semana | Ação |
|---|---|
| 1-2 | Search terms report diário, adicionar negativas agressivamente, pausar keywords CPC > 2x meta |
| 3-4 | Analisar Quality Score, mover budget de ad groups com baixo CTR para os melhores |
| 5-6 | Se > 30 conversões: migrar para Target CPA bidding |
| Mensal | Revisar performance por país, testar novos headlines, expandir keywords winners |
| Trimestral | Considerar adicionar UK/US se ROI dos tiers atuais estiver validado |

---

## Extensions (obrigatório)

### Sitelinks (todos os ad groups)
| Link | URL |
|---|---|
| Get Free License | orbit-core.org/register.html |
| View Architecture | orbit-core.org/#flow |
| GitHub — Apache 2.0 | github.com/rmfaria/orbit-core |
| Quick Start (5 min) | github.com/rmfaria/orbit-core#-quick-start |

### Callout Extensions
- Free Forever
- Self-Hosted
- AI-Powered Connectors
- OpenTelemetry Native
- Docker-Ready
- No Per-Host Pricing

### Structured Snippets
- **Types**: Metrics, Events, Security Alerts, Dashboards, Correlations
- **Integrations**: Nagios, Wazuh, Suricata, OpenTelemetry, n8n, Zabbix
- **Features**: AI Connector Generator, AI Dashboard Designer, Smart Alerts, Auto-Rollups

---

## Checklist pré-lançamento

- [ ] Verificar identidade do anunciante no Google Ads (obrigatório 2025+)
- [ ] Confirmar HTTPS em orbit-core.org (OK)
- [ ] Confirmar que register.html não tem auto-download (OK)
- [ ] Confirmar conversion tracking tag no register.html (OK)
- [ ] Configurar Google Analytics 4 com eventos de registro
- [ ] Adicionar TODAS as keywords negativas listadas acima
- [ ] Configurar sitelinks, callouts e structured snippets
- [ ] Ajustar bid modifiers: +20% desktop, -30% mobile
- [ ] Definir schedule: Seg-Sex 7h-20h por fuso de cada tier
- [ ] Criar audience layers: IT Decision Makers, Technology, Business Services
- [ ] Configurar geo bid adjustments por país conforme CPC target
- [ ] Testar landing page em inglês — verificar load time < 3s (Core Web Vitals)

---

## Resumo executivo

| Item | Valor |
|---|---|
| **Campanha** | 1 campanha Search, 5 ad groups |
| **Budget** | $30/dia (~$900/mês) |
| **Mercado primário** | Europa (DE, NL, Nordics, CH, AT, PL) + Israel |
| **Mercado secundário** | Singapura, Brasil, Canadá |
| **Mercado de volume** | Índia |
| **Mercados excluídos** | USA, UK, AU (CPC alto demais para o budget) |
| **Keywords** | 48 keywords em 5 clusters |
| **Narrativa principal** | "Self-hosted observability with data sovereignty + AI" |
| **CPC médio esperado** | ~$2.25 (global blend) |
| **Clicks/mês estimados** | ~400 |
| **Registros/mês estimados** | 15-24 |
| **Diferencial no Ads** | "AI generates connectors" — único no mercado |
| **Risco de políticas** | Nenhum blocker identificado |
| **Tese geográfica** | "Europe-First Sovereignty Play" — 69% das orgs EU preferem self-hosted, GDPR/NIS2 são tailwinds |
