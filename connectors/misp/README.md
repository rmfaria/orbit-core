# MISP Connector

Pulls threat intelligence (IoC attributes) from a MISP instance and ships them to orbit-core.

## What it does

1. Polls MISP `/attributes/restSearch` for new/modified attributes since last run
2. Fetches associated MISP events for threat level and context
3. Transforms attributes into orbit `threat_indicators` (IoCs)
4. Ships high/medium severity IoCs as orbit events for dashboard visibility
5. Tracks last pull timestamp in state file for incremental syncing

## Setup

```bash
# Required
export MISP_URL=https://misp.example.com
export MISP_API_KEY=your-automation-key
export ORBIT_API=http://127.0.0.1:3000
export ORBIT_API_KEY=your-orbit-api-key

# Optional
export MISP_VERIFY_TLS=true          # default: true
export ONLY_IDS=true                 # only pull to_ids=true attributes (default: true)
export INCLUDE_TYPES=ip-src,ip-dst,domain,md5,sha256,url  # filter types (default: all)
export INITIAL_LOOKBACK_HOURS=24     # first run lookback (default: 24)
export BATCH_SIZE=200                # indicators per POST (default: 200)
export STATE_PATH=/var/lib/orbit-core/misp.state.json
```

## Install

```bash
cp cron.example /etc/cron.d/orbit-misp
# Edit env vars in the cron file
```

## Dependencies

```bash
pip3 install requests urllib3
```
