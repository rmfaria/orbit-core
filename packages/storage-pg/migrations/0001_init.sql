-- Orbit MVP schema (Postgres)

create table if not exists events (
  id bigserial primary key,
  source text not null,             -- e.g. 'wazuh'
  ingested_at timestamptz not null default now(),
  event_time timestamptz null,
  agent_id text null,
  rule_id text null,
  level int null,
  raw jsonb not null
);

create index if not exists idx_events_ingested_at on events(ingested_at);
create index if not exists idx_events_event_time on events(event_time);
create index if not exists idx_events_agent_id on events(agent_id);
create index if not exists idx_events_rule_id on events(rule_id);
