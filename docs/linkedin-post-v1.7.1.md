Orbit Core v1.7.1 just shipped.

The big one: Security Health Map — a hex-grid visualization that shows the security posture of every asset at a glance. Each hexagon is color-coded (green/yellow/red) based on a 0–100 score, with neon glow on critical assets and pulsing indicators when IoCs match. Hover any hex to see severity breakdown, active sources, and matched IPs.

Threat Intelligence got a complete filter overhaul. Indicators now have type selects with counts, tag search, source filtering, and an enabled/disabled toggle. Matches got inline time range pickers, matched value search, and asset filters. The API supports tag filtering on JSONB, matched_value, and namespace queries. All panels have clear buttons and enter-to-search.

Performance — the numbers that matter:
- Health map query: 19.3s → 293ms (CTE pre-aggregation)
- IoC lookup: 51ms → 0.23ms (functional index on lower(value))
- MAX_ROWS cap at 100K to keep queries predictable

Also fixed chart initialization on the Threat Intel overview (lazy-create when canvas mounts), added always-visible indicator breakdown bars, and a "no matches" hint so the UI isn't a blank page when there's no data.

Self-hosted. Your data stays on your server. Always.

Apache-2.0 — free forever.

https://github.com/rmfaria/orbit-core

#CyberSecurity #SIEM #ThreatIntelligence #OpenSource #InfoSec #SecurityOperations #DevSecOps #Observability #SOC #BlueTeam
