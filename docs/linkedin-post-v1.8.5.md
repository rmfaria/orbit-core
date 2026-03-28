Orbit Core v1.8.5 — Live Feed Redesign & Investigate

We rethought the home screen from scratch. The old layout had four host-metric charts taking up half the screen and a narrow event feed squeezed to the side. For a security operations tool, the events are what matters — not CPU load graphs you glance at once a day.

The home is now a full-width live event feed. Seven sources (Nagios, Wazuh, Suricata, MISP, n8n, OpenTelemetry, FortiGate) stream into a single consolidated view. Each row shows a severity accent, namespace tag, title, and timestamp — all in one line. Click any row and a drilldown panel slides in with metadata cards (severity, source, asset, kind, timestamp) and the full log message in a monospace code block. No page navigation, no modal — just expand in place.

The Investigate search box sits at the top. Type anything and it queries the database directly — ilike search across title, message, and asset_id with 400ms debounce. This is not client-side filtering on the 40 events already loaded. It goes deep into the full event history, returning up to 200 results per source. Source and severity filters work client-side for instant toggling without API roundtrips. Date/time pickers let you narrow or widen the window down to the minute.

System KPIs (CPU, memory, disk, network, API status, DB status) are still there but compressed into a slim horizontal strip — one row of compact cards instead of the old tall blocks.

On the DevOps side, this release adds full CI/CD with GitHub Actions. Every push to main and every PR runs lint, typecheck, test, and build. On merge to main, the CD pipeline SSHs into production and runs the deploy script — git pull, install, build, migrate, restart, health check. No more manual deploys.

The events query API also got a new `search` parameter. Any OrbitQL events query can now include `search: "term"` for case-insensitive matching across title, message, and asset_id at the database level.

Self-hosted. Your data stays on your server. Always.

Apache-2.0 — free forever.

https://github.com/rmfaria/orbit-core

#CyberSecurity #SIEM #ThreatIntelligence #OpenSource #InfoSec #SecurityOperations #DevSecOps #Observability #SOC #BlueTeam
