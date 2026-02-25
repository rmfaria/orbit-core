# Fortigate (via Wazuh) — Connector Notes (orbit-core)

**Creator:** Rodrigo Menchio <rodrigomenchio@gmail.com>

Fortigate does not have a standalone connector.
Integration is done through **Wazuh syslog forwarding**:

- Fortigate sends syslogs to the Wazuh Manager
- the Wazuh connector ships them to orbit-core as normalized events

## Data flow

```
Fortigate → syslog (UDP/TCP 514) → Wazuh Manager → orbit-core
```

Events arrive as:
- `namespace = wazuh`
- `kind = fortigate`
- `severity` mapped from Wazuh rule level

## Fortigate configuration

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

## Wazuh notes

Wazuh ships Fortigate events when Fortigate rules are present (group `fortigate`).

Verify rules:

```bash
grep -r "fortigate" /var/ossec/ruleset/rules/ | head -5
```

### How `kind=fortigate` is generated

The Wazuh connector sets `kind` from `rule.groups[0]`:

```text
rule.groups = ["fortigate", "firewall"]  →  kind = "fortigate"
```

Requirement: Fortigate rules must include `fortigate` as the **first** group.

### UI source separation

Although Fortigate events are stored under `namespace=wazuh`, the UI surfaces them as a separate source using `kind=fortigate`.

## Field mapping (typical)

| Fortigate field | orbit-core |
|---|---|
| `devname` | `attributes.devname` (parsed from `full_log`) |
| full log | `message` |

## Verification

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

Notes:
- Fortigate events are ingested by the Wazuh connector (`connectors/wazuh/ship_events.py`)
- there is no extra script required as long as Wazuh is receiving the syslogs
