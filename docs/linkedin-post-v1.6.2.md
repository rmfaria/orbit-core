## LinkedIn Post — orbit-core v1.6.2

---

Nova release: orbit-core v1.6.2

Depois de semanas de desenvolvimento intenso, acabei de publicar a v1.6.2 do orbit-core — e essa é a release mais completa até agora.

O que mudou:

**1. AI Designer — Smart Dashboards**
Descreva em texto livre o dashboard que você quer. A IA gera uma página completa (HTML/CSS/JS) com dados reais da sua infraestrutura. Sem templates prontos, sem drag-and-drop — só descreva e ele monta.

Por baixo, criei o orbit-viz.js: um engine de visualização com web components (<orbit-chart>, <orbit-gauge>, <orbit-table>) renderizados em iframes isolados.

**2. Alertas por Email (SMTP)**
Agora os alertas disparam por email — além de webhook e Telegram. Template HTML dark, configuração SMTP direto na UI, email de teste em um clique.

A tela de Alertas foi reescrita do zero: cards visuais por canal com ícones, regras com borda colorida por estado (verde=ok, vermelho=firing, amarelo=silenciado), pills de severidade, dropdowns alimentados pelo catálogo de assets.

**3. Connector Run Tracking**
Shippers push-mode (Suricata, Nagios, Wazuh) agora registram histórico de execução via header X-Source-Id. Sem mudar código do shipper — basta um header e cada execução aparece no painel de Connectors com status, contagem e timestamp.

**4. Validação inteligente de canais**
Substituí a validação z.union (que gerava erros confusos) por superRefine com validação baseada no tipo do canal. Agora cada tipo (email/telegram/webhook) mostra erros claros e específicos.

Outras melhorias:
- Navegação Analysis agrupando Events + Metrics + Correlations
- Seleção independente de assets no chart picker
- Fix de duplicação no orbit-viz.js com versionamento monotônico
- Cache otimizado para orbit-viz.js (nginx max-age=300)
- Fix de particionamento na migration 0021
- Melhorias de performance em API, banco e UI

Tudo self-hosted, Postgres-backed, API-first.
Um `docker compose up -d` e está rodando.

GitHub: https://github.com/rmfaria/orbit-core
Release: https://github.com/rmfaria/orbit-core/releases/tag/v1.6.2

#observability #monitoring #opensource #selfhosted #devops #sre #ai #telemetry #orbitcore #newrelease
