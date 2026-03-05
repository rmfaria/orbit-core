## LinkedIn Post — orbit-core v1.6.2 (EN)

---

New release: orbit-core v1.6.2

After weeks of intense development, I just published orbit-core v1.6.2 — the most complete release so far.

What's new:

**1. AI Designer — Smart Dashboards**
Describe the dashboard you want in plain text. The AI generates a complete page (HTML/CSS/JS) with live data from your infrastructure. No templates, no drag-and-drop — just describe it and it builds it.

Under the hood, I built orbit-viz.js: a visualization engine with web components (<orbit-chart>, <orbit-gauge>, <orbit-table>) rendered inside sandboxed iframes.

**2. Email Alerting (SMTP)**
Alerts now fire via email — alongside webhook and Telegram. Dark-themed HTML template, SMTP settings managed directly in the UI, test email in one click.

The Alerts page was rewritten from scratch: visual channel cards with icons, rule cards with color-coded state borders (green=ok, red=firing, yellow=silenced), severity pills, catalog-powered asset dropdowns.

**3. Connector Run Tracking**
Push-mode shippers (Suricata, Nagios, Wazuh) now record execution history via an X-Source-Id header. No code changes to the shipper — just one header and every run shows up in the Connectors UI with status, count and timestamp.

**4. Smart channel validation**
Replaced z.union validation (which produced confusing errors) with superRefine kind-based validation. Each channel type (email/telegram/webhook) now shows clear, specific error messages.

Other improvements:
- Analysis nav grouping Events + Metrics + Correlations
- Independent asset selection in chart picker
- orbit-viz.js duplication fix with monotonic version counter
- Optimized cache for orbit-viz.js (nginx max-age=300)
- Migration 0021 partitioning fix
- Performance improvements across API, DB and UI

Everything is self-hosted, Postgres-backed, API-first.
One `docker compose up -d` and you're running.

GitHub: https://github.com/rmfaria/orbit-core
Release: https://github.com/rmfaria/orbit-core/releases/tag/v1.6.2

#observability #monitoring #opensource #selfhosted #devops #sre #ai #telemetry #orbitcore #newrelease
