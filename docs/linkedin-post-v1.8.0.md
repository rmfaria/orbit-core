Orbit Core v1.8.0 — AI-Powered Alert Engine

Describe what you want to monitor in plain English. The AI builds production-ready alert rules from your live data catalog.

"Monitor CPU on all hosts, alert on critical Wazuh events, detect metric absence" — and the AI generates threshold rules, absence checks, and severity-mapped alerts using your actual 458 metrics across 200 assets and 10 event namespaces.

What's new in v1.8.0:

- AI Alert Generator — natural language to alert rules, powered by RAG context from your live metric and event catalog. Quick suggestion chips, preview with apply/reject per rule, and automatic channel assignment.

- Webhook Test Modal — full notification testing panel with animated progress bar, JSON payload preview (see exactly what gets POSTed), error diagnostics, and re-send without closing. Works for webhook, Telegram, and email channels.

- Smart Channel Cards — inline metadata (URL, recipients, chat ID), auto-generated slug IDs from names, hover glow animations, and backdrop blur on all modals.

- Health Map Performance — 5-minute in-memory cache with request coalescing. Pre-selects top-40 assets to maintain sub-300ms query times even at scale.

- n8n Webhook Workflow — pre-built workflow that receives orbit-core alert webhooks and sends formatted HTML emails via SMTP.

- Asset Drilldown — click any hex on the Security Health Map to see severity timeline and IoC match details.

Built for security teams who want AI-assisted monitoring without sending their data to the cloud.

Self-hosted. Your data stays on your server. Always.
Apache-2.0 — free forever.

https://github.com/rmfaria/orbit-core

#CyberSecurity #SIEM #ThreatIntelligence #OpenSource #InfoSec #SecurityOperations #DevSecOps #Observability #SOC #BlueTeam
