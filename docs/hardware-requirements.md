# Orbit Core — Hardware Requirements & Scaling Guide

> Based on real benchmarks from prod.nesecurity.com.br (2026-03-09)

---

## Current Baseline (Production)

| Resource | Value |
|----------|-------|
| CPU | 2 vCPU (AMD EPYC 9354P) |
| RAM | 8 GB |
| Disk | 96 GB SSD |
| DB size | ~12 GB (9 days of March = ~5M events) |
| Containers | 1× API, 1× PostgreSQL 16, 1× UI (nginx) |
| Sustained EPS | ~1,500–2,000 |
| Peak EPS | ~3,650 (remote clients) |
| Daily storage growth | ~500 MB/day at current load |

---

## Scaling Tiers

### Tier 1 — Starter (Home Lab / POC)

| Resource | Spec |
|----------|------|
| **CPU** | 1 vCPU |
| **RAM** | 2 GB |
| **Disk** | 20 GB SSD |
| **EPS capacity** | ~200–500 |
| **Events/day** | up to ~5M |
| **Retention** | ~7 days |
| **Use case** | Single source (e.g., Nagios or Wazuh alone) |
| **Docker** | All-in-one (API + PG + UI) |
| **Monthly cost** | ~$5–10 (Hetzner/DigitalOcean) |

### Tier 2 — Small (Current Production)

| Resource | Spec |
|----------|------|
| **CPU** | 2 vCPU |
| **RAM** | 8 GB |
| **Disk** | 100 GB SSD |
| **EPS capacity** | ~1,500–2,000 |
| **Events/day** | up to ~15M |
| **Retention** | ~30 days |
| **Connectors** | 3–5 sources |
| **Docker** | 1× API, 1× PG, 1× UI |
| **Monthly cost** | ~$15–25 |

### Tier 3 — Medium (Multi-source, longer retention)

| Resource | Spec |
|----------|------|
| **CPU** | 4 vCPU |
| **RAM** | 16 GB |
| **Disk** | 250 GB NVMe |
| **PG pool** | 50 connections |
| **EPS capacity** | ~4,000–6,000 ¹ |
| **Events/day** | up to ~50M |
| **Retention** | ~90 days |
| **Connectors** | 5–15 sources |
| **Docker** | 2× API replicas, 1× PG, 1× UI |
| **Monthly cost** | ~$30–50 |

### Tier 4 — Large (Enterprise SOC)

| Resource | Spec |
|----------|------|
| **CPU** | 8 vCPU |
| **RAM** | 32 GB |
| **Disk** | 500 GB NVMe |
| **PG pool** | 100 connections |
| **EPS capacity** | ~10,000–15,000 ¹ |
| **Events/day** | up to ~150M |
| **Retention** | ~180 days |
| **Connectors** | 15–50 sources |
| **Docker** | 4× API replicas, 1× PG (dedicated), 1× UI |
| **Recommended** | Separate PG on dedicated VM/container |
| **Monthly cost** | ~$80–150 |

### Tier 5 — XL (High-Volume MSSP)

| Resource | Spec |
|----------|------|
| **CPU** | 16+ vCPU |
| **RAM** | 64+ GB |
| **Disk** | 1+ TB NVMe |
| **PG pool** | 200 connections + PgBouncer |
| **EPS capacity** | ~20,000–40,000 ¹ |
| **Events/day** | up to ~500M |
| **Retention** | ~365 days |
| **Connectors** | 50+ sources |
| **Docker** | 8× API replicas, PG cluster (primary + read replica), UI CDN |
| **Recommended** | TimescaleDB, dedicated DB server, partitioned tables |
| **Monthly cost** | ~$300–600 |

> ¹ Projected based on linear scaling of PostgreSQL write throughput with additional CPU/RAM. Actual numbers depend on disk I/O, INSERT optimization (multi-row VALUES), and PG tuning.

---

## Scaling Factors & Bottlenecks

### What scales linearly
| Factor | Impact |
|--------|--------|
| **API replicas** | +50–80% EPS per additional replica (Node.js is single-threaded) |
| **PG RAM** | More shared_buffers = fewer disk writes = faster INSERTs |
| **PG CPU cores** | More parallel INSERT handling |
| **NVMe vs SSD** | ~2–3× faster write IOPS |

### What doesn't scale linearly
| Factor | Why |
|--------|-----|
| **More writers without more PG resources** | Contention on PG pool, latency increases |
| **Larger batch sizes** | Diminishing returns past 2K events/batch |
| **More RAM without more CPU** | INSERT is CPU+IO bound, not memory bound |

### Current bottleneck breakdown
```
Request flow:  Client → Traefik → Express API → PostgreSQL INSERT
Latency:          ~5ms     ~2ms      ~5ms         ~800-2000ms
                                                   ^^^^^^^^^^^
                                              95%+ of total time
```

---

## Storage Estimation

| Events/day | Daily growth | 30 days | 90 days | 365 days |
|------------|-------------|---------|---------|----------|
| 500K | ~50 MB | 1.5 GB | 4.5 GB | 18 GB |
| 2M | ~200 MB | 6 GB | 18 GB | 73 GB |
| 5M | ~500 MB | 15 GB | 45 GB | 182 GB |
| 15M | ~1.5 GB | 45 GB | 135 GB | 547 GB |
| 50M | ~5 GB | 150 GB | 450 GB | 1.8 TB |
| 150M | ~15 GB | 450 GB | 1.3 TB | 5.4 TB |

> Based on observed ~100 bytes/event average in orbit_events (including indexes).
> Metrics add ~10–20% on top depending on volume.

---

## PostgreSQL Tuning by Tier

| Parameter | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 |
|-----------|--------|--------|--------|--------|--------|
| `shared_buffers` | 512 MB | 2 GB | 4 GB | 8 GB | 16 GB |
| `work_mem` | 4 MB | 16 MB | 32 MB | 64 MB | 128 MB |
| `effective_cache_size` | 1 GB | 6 GB | 12 GB | 24 GB | 48 GB |
| `max_connections` | 20 | 50 | 100 | 200 | 400 |
| `wal_buffers` | 16 MB | 64 MB | 128 MB | 256 MB | 512 MB |
| `checkpoint_completion_target` | 0.9 | 0.9 | 0.9 | 0.9 | 0.9 |
| `random_page_cost` | 1.1 | 1.1 | 1.1 | 1.1 | 1.1 |

---

## Docker Compose Examples

### Tier 1 (Starter)
```yaml
services:
  api:
    image: orbit-core:latest
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 512M }
  pg:
    image: postgres:16-alpine
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 1G }
    environment:
      POSTGRES_SHARED_BUFFERS: 256MB
```

### Tier 3 (Medium)
```yaml
services:
  api:
    image: orbit-core:latest
    deploy:
      replicas: 2
      resources:
        limits: { cpus: "1", memory: 1G }
  pg:
    image: postgres:16-alpine
    deploy:
      resources:
        limits: { cpus: "2", memory: 8G }
    command: >
      postgres
        -c shared_buffers=4GB
        -c work_mem=32MB
        -c effective_cache_size=12GB
        -c max_connections=100
```

### Tier 5 (XL)
```yaml
services:
  api:
    image: orbit-core:latest
    deploy:
      replicas: 8
      resources:
        limits: { cpus: "2", memory: 2G }
  pg:
    image: timescale/timescaledb:latest-pg16
    deploy:
      resources:
        limits: { cpus: "8", memory: 32G }
      placement:
        constraints: [node.labels.role == database]
    command: >
      postgres
        -c shared_buffers=16GB
        -c work_mem=128MB
        -c effective_cache_size=48GB
        -c max_connections=400
  pgbouncer:
    image: edoburu/pgbouncer
    environment:
      POOL_MODE: transaction
      MAX_CLIENT_CONN: 1000
      DEFAULT_POOL_SIZE: 200
```

---

## Quick Sizing Calculator

```
Required EPS × 86,400 = Events/day
Events/day × 100 bytes = Daily storage
Daily storage × retention days = Total disk needed
Total disk × 1.3 = Disk with safety margin
```

**Example**: 1,000 EPS sustained
- 1,000 × 86,400 = 86.4M events/day
- 86.4M × 100 bytes = 8.6 GB/day
- 8.6 GB × 30 days = 258 GB for 30-day retention
- 258 × 1.3 = **335 GB disk recommended** → Tier 4
