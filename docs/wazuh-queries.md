# Wazuh Query Examples (Postgres JSONB)

These examples assume Wazuh events are inserted into:

- table: `events`
- column: `raw jsonb`

and that some promoted columns exist (`agent_id`, `rule_id`, `level`, `event_time`).

## Insert example (manual)

```sql
insert into events(source, event_time, agent_id, rule_id, level, raw)
values (
  'wazuh',
  now(),
  '001',
  '5715',
  10,
  '{"rule": {"id": "5715", "level": 10}, "agent": {"id": "001"}, "data": {"srcip": "10.0.0.5"}}'::jsonb
);
```

## 1) Latest high-severity alerts

```sql
select id, event_time, agent_id, rule_id, level, raw
from events
where level >= 10
order by event_time desc nulls last
limit 100;
```

## 2) Top rules by count (last 24h)

```sql
select rule_id, count(*)
from events
where event_time >= now() - interval '24 hours'
group by rule_id
order by count(*) desc
limit 20;
```

## 3) Alerts by agent

```sql
select agent_id, count(*)
from events
where level >= 7
group by agent_id
order by count(*) desc;
```

## 4) Extract nested JSON fields

Example: `raw->'data'->>'srcip'`

```sql
select
  raw->'data'->>'srcip' as src_ip,
  count(*)
from events
where raw->'data' ? 'srcip'
group by 1
order by 2 desc
limit 50;
```

## 5) Failed logins (example pattern)

This depends on Wazuh rules/decoders in your environment.

```sql
select event_time, agent_id, raw
from events
where raw->'rule'->>'id' in ('5715','5716')
order by event_time desc
limit 200;
```

## Suggested indexes (future)

- GIN on `raw` for JSONB containment queries:

```sql
create index if not exists idx_events_raw_gin on events using gin (raw);
```

- Expression indexes for common paths:

```sql
create index if not exists idx_events_srcip on events ((raw->'data'->>'srcip'));
```
