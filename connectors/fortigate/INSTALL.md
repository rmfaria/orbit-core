# Fortigate (via Wazuh) — Installation Guide

Fortigate does not have a standalone connector.
Integration uses the existing Wazuh pipeline:

```
Fortigate → syslog 514 → Wazuh Manager → (Wazuh connector) → orbit-core
```

Prerequisite: the Wazuh connector (`connectors/wazuh/`) must already be installed and running.

## 0) Prerequisites

- Wazuh Manager running and ingesting alerts
- CLI access to Fortigate (or access to configure syslog)
- network path between Fortigate and Wazuh Manager (UDP/TCP 514)

Verify Wazuh connector is active:

```bash
cat /var/lib/orbit-core/wazuh-events.state.json || true
# expected: a JSON state file that updates over time
```

## 1) Configure syslog on Fortigate

Fortigate CLI:

```text
config log syslogd setting
    set status enable
    set server <WAZUH_MANAGER_IP>
    set port 514
    set facility local7
    set format default
end
```

Optional: restrict what is sent using Fortigate log settings (depends on your policy).

## 2) Verify reception on Wazuh Manager

After a few seconds (with traffic), verify syslogs are arriving and being parsed:

```bash
# watch alerts and filter fortigate groups
 tail -f /var/ossec/logs/alerts/alerts.json | python3 -c "
import sys, json
for line in sys.stdin:
    a = json.loads(line)
    gs = (a.get('rule',{}).get('groups') or [])
    if gs and gs[0] == 'fortigate':
        print(gs, a.get('rule',{}).get('description',''))
"
```

## 3) Verify events in orbit-core

```bash
curl -s -H "X-Api-Key: <your-key>" \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "kind":"events",
    "namespace":"wazuh",
    "kinds":["fortigate"],
    "from":"...",
    "to":"...",
    "limit":20
  }'
```

## Troubleshooting

- No Fortigate alerts in `alerts.json`: syslog not reaching Wazuh; check firewall and port 514
- Alerts present but `kind != fortigate`: rules missing or `fortigate` is not the first group
- Wazuh has alerts but orbit-core has none: the Wazuh connector cron is not running; check `/etc/cron.d/orbit-wazuh` and logs
