Orbit Core v1.8.3 — Performance & Reliability Across the Stack

PostgreSQL was eating 95% CPU on our 16 GB prod server. We traced it to two root causes and fixed both in a single release.

The threat intelligence worker was running a batch lookup with = ANY(large_array) against 150k indicators — the planner chose sequential scans every 2 minutes, reading 215 million rows per cycle. Replacing it with a VALUES JOIN forces index scans. CPU dropped from 95.4% to 0.06%.

On the same pass, we tuned autovacuum for partitioned tables. The default scale_factor of 0.2 on a 15-million-row partition means vacuum only kicks in after 3 million dead tuples pile up. Now it runs at 0.02 — catching bloat 10x earlier.

Alert reliability got a major upgrade. The worker previously only notified on state transitions (ok to firing). If the webhook was down at that exact moment, the alert was lost forever. Now:

- Failed notifications retry automatically on the next tick (60s)
- Firing rules re-send a reminder every 30 minutes
- No more silent failures

We also added 6 new alert rules out of the box: CPU load, disk space, memory usage, packet loss, Nagios shipper absence, and Orbit API health. Total: 12 active rules covering Wazuh, Nagios, and OTEL.

On the UI side, the Events tab in Analysis now has a real-time log search filter — type any string and it instantly filters across title, message, asset, namespace, and kind. The table is fully responsive with a card layout on mobile.

Self-hosted. Your data stays on your server. Always.

Apache-2.0 — free forever.

https://github.com/rmfaria/orbit-core

#CyberSecurity #SIEM #ThreatIntelligence #OpenSource #InfoSec #SecurityOperations #DevSecOps #Observability #SOC #BlueTeam
