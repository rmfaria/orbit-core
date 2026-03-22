Orbit Core v1.8.2 — Smart Alert Delivery

Your alerts were configured. Your rules were firing. But nobody got notified.

We tracked down three silent failures in the alert pipeline and fixed them all in v1.8.2:

1. SSRF guard was blocking webhook calls to internal n8n — new ORBIT_WEBHOOK_ALLOWLIST env var lets you whitelist trusted hosts like self-hosted n8n on Docker networks.

2. Alert rules pointed to a non-existent channel ID — the UI now lets you edit assigned channels inline. Expand any rule, pick new channels, save. No need to delete and recreate.

3. Webhook URL pointed to an inactive n8n cloud instance — channel cards now have an Edit button to update URLs, recipients, or bot tokens on the spot.

Plus: a new pre-built n8n workflow sends rich HTML alert emails via Gmail OAuth2. Severity-colored cards, value highlights, and clean detail rows — designed to render properly in Gmail's forced light-background mode.

The alert engine now actually delivers. Threshold breaches, data absence, Wazuh disconnections — they all reach your inbox within 60 seconds.

Self-hosted. Your data stays on your server. Always.

Apache-2.0 — free forever.

https://github.com/rmfaria/orbit-core

#CyberSecurity #SIEM #ThreatIntelligence #OpenSource #InfoSec #SecurityOperations #DevSecOps #Observability #SOC #BlueTeam
