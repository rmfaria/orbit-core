-- Orbit Core canonical schema (MVP1)

-- Assets catalog
create table if not exists assets (
  asset_id text primary key,
  type text not null,
  name text not null,
  labels jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  criticality text null,
  enabled boolean not null default true,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists idx_assets_type on assets(type);
create index if not exists idx_assets_enabled on assets(enabled);
create index if not exists idx_assets_tags_gin on assets using gin(tags);
create index if not exists idx_assets_labels_gin on assets using gin(labels);

-- Metric points (raw)
create table if not exists metric_points (
  id bigserial primary key,
  ts timestamptz not null,
  asset_id text not null references assets(asset_id) on delete cascade,
  namespace text not null,
  metric text not null,
  value double precision not null,
  unit text null,
  dimensions jsonb not null default '{}'::jsonb
);

create index if not exists idx_metric_points_ts on metric_points(ts desc);
create index if not exists idx_metric_points_asset_ts on metric_points(asset_id, ts desc);
create index if not exists idx_metric_points_ns_metric_ts on metric_points(namespace, metric, ts desc);
create index if not exists idx_metric_points_dims_gin on metric_points using gin(dimensions);

-- Events (canonical)
create table if not exists orbit_events (
  id bigserial primary key,
  ts timestamptz not null,
  asset_id text not null references assets(asset_id) on delete cascade,
  namespace text not null,
  kind text not null,
  severity text not null,
  title text not null,
  message text null,
  fingerprint text null,
  attributes jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now()
);

create index if not exists idx_orbit_events_ts on orbit_events(ts desc);
create index if not exists idx_orbit_events_asset_ts on orbit_events(asset_id, ts desc);
create index if not exists idx_orbit_events_sev_ts on orbit_events(severity, ts desc);
create index if not exists idx_orbit_events_kind_ts on orbit_events(kind, ts desc);

-- Dashboards
create table if not exists dashboards (
  id bigserial primary key,
  name text not null,
  description text null,
  tags text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dashboards_enabled on dashboards(enabled);
create index if not exists idx_dashboards_tags_gin on dashboards using gin(tags);

create table if not exists widgets (
  id bigserial primary key,
  dashboard_id bigint not null references dashboards(id) on delete cascade,
  title text not null,
  kind text not null,
  query jsonb not null default '{}'::jsonb,
  viz jsonb not null default '{}'::jsonb,
  position jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_widgets_dashboard on widgets(dashboard_id);
create index if not exists idx_widgets_enabled on widgets(enabled);

-- updated_at triggers
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname='dashboards_set_updated_at') then
    create trigger dashboards_set_updated_at before update on dashboards
      for each row execute function set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname='widgets_set_updated_at') then
    create trigger widgets_set_updated_at before update on widgets
      for each row execute function set_updated_at();
  end if;
end$$;
