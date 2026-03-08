# LinkedIn Post — Orbit Core v1.6.3

---

Orbit Core v1.6.3 — Native Wazuh SIEM, security hardening, and performance optimization.

We just shipped one of the biggest Orbit Core updates, focused on three pillars: visibility, security, and performance.

**Full Wazuh SIEM Dashboard**
Native Wazuh integration with a dedicated dashboard — 6 sub-tabs: Overview, Agents, Compliance (SCA), Vulnerabilities, MITRE ATT&CK, and Events. The EPS chart now shows distribution by event category (agent, sca, vulnerability, syscollector, fim, audit) with stacked areas and per-category colors. Everything served in a single API call with 10 parallel queries and 60s response cache.

**10 Security Fixes**
Full security audit: 47 findings identified, 10 critical/high fixed in this release:
- SSRF protection against private IPs, cloud metadata, and DNS rebinding
- Configurable CORS per environment
- Timing-safe API key comparison
- Login rate limiting (5 req/min)
- Fail-closed auth when DB is unavailable
- XSS fix in the visualization engine

**Performance Optimization**
50-finding performance audit. High-impact fixes applied:
- Composite indexes on main event and rollup tables
- Response cache on the Wazuh summary endpoint
- Alert worker overlap guard
- Automatic source inference in EPS tracker
- Data retention automation for old records

**Mobile Responsiveness**
Complete responsiveness review — modals, grids, navigation, and charts adapt seamlessly from 320px to 1920px+.

Orbit Core is open-source and free for up to 50 assets.

https://github.com/rmfaria/orbit-core

#observability #siem #wazuh #monitoring #cybersecurity #opensource #devops #sre #infrastructure #orbitcore
