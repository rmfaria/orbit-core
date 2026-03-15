Most SIEM platforms treat threat intelligence as a separate product. A second dashboard. A second vendor. A second bill.

We just shipped MISP integration directly into Orbit Core.

Here's what v1.7.0 does:

A Python connector polls your MISP instance every 5 minutes, pulls IoC attributes (IPs, domains, hashes, URLs), and stores them in a dedicated threat_indicators table with TLP tags, threat levels, and expiration tracking.

Then something interesting happens.

A background correlation worker runs every 2 minutes inside the API. It scans every incoming event from Wazuh, Suricata, Nagios — extracts IPs, domains, and hashes from the event attributes — and batch-checks them against your active indicators.

When a match is found: an ioc.hit event fires immediately. The original event, the matched IoC, the MISP source, the threat level — all linked in one record.

No manual triage. No copy-pasting IPs into VirusTotal. The correlation happens automatically, continuously, inside your own infrastructure.

The new Threat Intel dashboard has 4 views:

- Overview — KPIs, severity distribution, match timeline, IoC type breakdown
- Indicators — searchable table with TLP tag pills, expandable detail panels
- Matches — every IoC hit with the original event context (asset, source, severity)
- Timeline — match activity over time with high-threat filtering

What's also in v1.7.0:

- New threat_indicators + threat_matches tables with trigram indexes for fuzzy matching
- Configurable MISP filters: to_ids only, type whitelist, max attributes per run
- Private IP filtering (skips 10.x, 192.168.x, 127.x) to avoid false positives
- Timezone fix for epoch calculation in the connector
- 7 new API endpoints for the full IoC lifecycle

The architecture is clean: MISP feeds IoCs → connector ships to Orbit → worker correlates with live events → dashboard shows everything. One pipeline. One database. One UI.

Self-hosted. Your threat intel stays on your server. Apache-2.0.

https://orbit-core.org

#CyberSecurity #ThreatIntelligence #MISP #Observability #OpenSource #SIEM #IoC #DevSecOps #Wazuh #InfoSec #SOC
