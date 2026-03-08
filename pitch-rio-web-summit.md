# Orbit Core — Pitch Rio Web Summit

## O Problema (30s)

Times de segurança e operações usam **5+ ferramentas separadas**: Prometheus para métricas, Grafana para dashboards, Wazuh para alertas, Elastic para logs, e ainda precisam de um SIEM no topo. Cada integração custa **dias de trabalho**. Quando algo quebra às 2h da manhã, o contexto está espalhado em UIs e linguagens de query diferentes.

**O resultado:** visibilidade fragmentada, tempo de resposta lento, custo altíssimo.

---

## A Solução (30s)

**Orbit Core** é um **core de telemetria open-source e self-hosted** que unifica métricas de infraestrutura, eventos de segurança e sinais de ameaça em uma única plataforma PostgreSQL.

Um comando. Cinco minutos. Tudo rodando:

```
docker compose up -d
```

---

## O Diferencial (45s)

### IA que escreve a integração por você

Descreva qualquer API HTTP em linguagem natural. A IA gera:
- Conector validado e pronto para deploy
- Script Python funcional
- Documentação

**Tempo até a primeira integração: minutos, não dias.**

Nenhum concorrente — nem Grafana, nem Splunk, nem Datadog — gera código de integração a partir de linguagem natural.

### Correlação automática

Motor de detecção de anomalias (Z-score) correlaciona automaticamente picos de métricas com eventos de segurança. Sem regras manuais.

### Deploy em 5 minutos

Não é SaaS. Não tem precificação por GB. Não tem vendor lock-in.
Seus dados ficam na **sua infraestrutura**.

---

## Para Quem (15s)

- **SOC teams** — timeline unificada de alertas de múltiplas fontes
- **MSSPs** — alternativa self-hosted ao Splunk/Elastic para múltiplos clientes
- **DevSecOps** — uma interface de query para Nagios, Wazuh, Fortigate, OTel

---

## Tração (15s)

- **v1.6.1** em produção com clientes ativos
- **10 conectores** prontos: Nagios, Wazuh, Fortigate, Suricata IDS, n8n, OpenTelemetry, Zabbix
- **Apache 2.0** — open source, sem custo de licença
- **298k+ métricas** e **3.9M eventos** processados no ambiente de produção
- Dashboard builder com IA, alerting com Telegram/webhook, OTLP nativo

---

## Modelo de Negócio (15s)

- **Core gratuito e open-source** (Apache 2.0)
- **Revenue via:** suporte enterprise, SLA garantido, integrações custom, consultoria de implantação
- **Expansão futura:** multi-tenancy, RBAC, SSO/OIDC, módulos premium de compliance

---

## O Ask (15s)

Buscamos **R$ 500K em investimento pré-seed** para:

1. Escalar o time de engenharia (2 devs + 1 DevRel)
2. Programa de design partners com 10 MSSPs no Brasil
3. Go-to-market focado em SOCs de médio porte na América Latina

---

## Encerramento (10s)

> "Orbit Core não substitui seu monitoramento ou SIEM — faz eles trabalharem juntos. Em 5 minutos. Com IA. De graça."

**orbit-core.org** | GitHub: rmfaria/orbit-core | Apache 2.0

---

*Contato: Rodrigo Menchio — rodrigomenchio@gmail.com*
