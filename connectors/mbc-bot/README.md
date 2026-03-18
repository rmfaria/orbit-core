# MBC Bot Connector

Push connector for the OpenClaw MBC WhatsApp pre-sales bot.

## Overview

Receives lead events and score metrics from the MBC bot engine running
at `prod.nesecurity.com.br/mbc/`. The engine pushes to orbit-core's
ingest API on every WhatsApp message processed.

- **Source ID**: `mbc-bot`
- **Namespace**: `mbc`
- **Mode**: push (engine → orbit-core)
- **Type**: event + metric

## Events

| Kind | Severity | Description |
|------|----------|-------------|
| `lead_update` | low | Lead state change (new message, score update) |
| `lead_update` | high | Handoff triggered (hot lead or keyword detected) |

## Metrics

| Metric | Description |
|--------|-------------|
| `lead.score` | Current lead score (per lead asset) |

## Setup

```bash
# Register connector
curl -X POST "$ORBIT_CORE_URL/api/v1/connectors" \
  -H "X-Api-Key: $ORBIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d @connectors/mbc-bot/connector-spec.json

# Approve
curl -X POST "$ORBIT_CORE_URL/api/v1/connectors/mbc-bot/approve" \
  -H "X-Api-Key: $ORBIT_API_KEY"
```

## Related

- Engine source: [deed-growth](https://github.com/rmfaria/deed-growth) (`deploy/openclaw-mbc/webhook-relay.mjs`)
- Dashboard: `https://prod.nesecurity.com.br/mbc/`
