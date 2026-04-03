# LinkedIn Post — Orbit Core v1.8.6

**Orbit Core v1.8.6 — Resilience & Quality Hardening**

We just shipped the most structurally significant release of Orbit Core yet. Not a single new feature — just engineering rigor applied across the entire stack.

**Structural score: 7.1 → 8.2 out of 10.**

Here's what changed:

🛡️ **Connector Resilience (4.5 → 9.0)**
Every one of our 9 Python shippers now has urllib3 retry with exponential backoff (3x, status 502/503/504). All 7 stateful connectors use atomic state files (write to temp + os.rename) — if the process crashes mid-write, the state file is never corrupted. The OpenSearch client also got retry support.

✅ **Tests & CI (2.5 → 7.0)**
From near-zero to 76 passing tests across 3 packages. We added integration tests using testcontainers with a real PostgreSQL instance — not mocks, real SQL. ESLint with typescript-eslint now runs in CI, and husky pre-commit hooks catch issues before they hit the repo.

🔒 **Security Hardening**
Dockerfile now runs as a non-root user (uid 1001). Ingest validates JSONB depth (max 3 levels) and size (max 4KB) to prevent resource exhaustion. New metrics dedup via ON CONFLICT ensures retried batches don't inflate values.

⚡ **Infrastructure**
PG connection pool scaled from 35 to 50. API service now defaults to 2 replicas. Rollup tables were already partitioned monthly (migration 0027) — confirmed during this audit.

The biggest takeaway: resilience isn't about adding features. It's about making the features you have survive real-world conditions — crashes, retries, network flakes, oversized payloads.

Self-hosted. Your data stays on your server. Always.

Apache-2.0 — free forever.

🔗 https://github.com/rmfaria/orbit-core

#CyberSecurity #SIEM #ThreatIntelligence #OpenSource #InfoSec #SecurityOperations #DevSecOps #Observability #SOC #BlueTeam
