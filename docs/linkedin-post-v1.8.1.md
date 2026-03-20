Orbit Core v1.8.1 — Dashboard Performance Patch

The Threat Intelligence health map was timing out. 54 seconds to scan 9.2M events across 779 assets on an 8GB VPS with 87% CPU steal. Every page load hit the database hard. Fixed it.

What changed in v1.8.1:

- Health Map Query Rewrite — replaced the LATERAL join (which scanned every asset individually) with a two-phase approach: first pick top-40 assets by IoC hits and recency, then enrich only those via index seeks. Cold query dropped from 54s to ~12s.

- 5-Minute In-Memory Cache — both the Threat Intel health map and Wazuh summary endpoint now cache results with a 5-minute TTL. After the first load, every subsequent request responds in under 200ms.

- Request Coalescing — when multiple users open the same dashboard simultaneously, all requests share a single inflight database query instead of each firing their own. Eliminates duplicate DB load under concurrent traffic.

- Statement Timeout Protection — heavy queries now have a 45-second safety net to prevent runaway connections from exhausting the connection pool on resource-constrained servers.

The numbers:
- Health Map: 54s → 0.08s (cached) — 675× faster
- Wazuh Summary: 11s → 0.2s (cached) — 55× faster

These are production measurements on a real 8GB VPS running PostgreSQL 16 with 9.2M events.

Self-hosted. Your data stays on your server. Always.
Apache-2.0 — free forever.

https://github.com/rmfaria/orbit-core

#CyberSecurity #SIEM #ThreatIntelligence #OpenSource #InfoSec #SecurityOperations #DevSecOps #Observability #SOC #BlueTeam
