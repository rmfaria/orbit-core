# Connectors — Claude Code Instructions

## Overview
Data shippers that push events/metrics to orbit-core's ingest API.

## Push Connectors (Python)
Each connector follows the same pattern:
1. Read JSONL/log file from disk
2. Track byte offset in `state.json` (fcntl locking)
3. Parse log entries into orbit event schema
4. POST batches to `/api/v1/ingest/events` (200 events/batch)
5. Detect log rotation: file size < offset → reset to 0

### Available
- `nagios/` — Nagios event log
- `wazuh/` — Wazuh alerts JSON
- `suricata/` — Suricata EVE-JSON
- `fortigate/` — Routes through Wazuh connector
- `misp/` — MISP threat intelligence (IoC attributes)

## Pull Connector (TypeScript)
- `n8n/` — TypeScript engine for pull-mode connectors
- Scheduled by worker in `packages/api/src/connectors/worker.ts`

## Auth
All connectors use `X-Api-Key` header for authentication.

## Conventions
- Python 3.x, no external dependencies (stdlib only)
- State file: `state.json` in connector directory
- Cron-driven: typically `*/2 * * * *`
- New connectors should follow the same pattern — see `nagios/` as reference
