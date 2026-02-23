-- Rollups + retention support (Postgres puro)

-- 5-minute rollups (retain ~90d)
create table if not exists metric_rollup_5m (
  bucket_ts timestamptz not null,
  asset_id text not null references assets(asset_id) on delete cascade,
  namespace text not null,
  metric text not null,
  dimensions jsonb not null default '{}'::jsonb,
  dimensions_hash text not null,
  avg double precision not null,
  min double precision not null,
  max double precision not null,
  sum double precision not null,
  count bigint not null,
  primary key (bucket_ts, asset_id, namespace, metric, dimensions_hash)
);

create index if not exists idx_rollup5_asset_ts on metric_rollup_5m(asset_id, bucket_ts desc);
create index if not exists idx_rollup5_ns_metric_ts on metric_rollup_5m(namespace, metric, bucket_ts desc);
create index if not exists idx_rollup5_dims_gin on metric_rollup_5m using gin(dimensions);

-- 1-hour rollups (retain ~180d)
create table if not exists metric_rollup_1h (
  bucket_ts timestamptz not null,
  asset_id text not null references assets(asset_id) on delete cascade,
  namespace text not null,
  metric text not null,
  dimensions jsonb not null default '{}'::jsonb,
  dimensions_hash text not null,
  avg double precision not null,
  min double precision not null,
  max double precision not null,
  sum double precision not null,
  count bigint not null,
  primary key (bucket_ts, asset_id, namespace, metric, dimensions_hash)
);

create index if not exists idx_rollup1h_asset_ts on metric_rollup_1h(asset_id, bucket_ts desc);
create index if not exists idx_rollup1h_ns_metric_ts on metric_rollup_1h(namespace, metric, bucket_ts desc);
create index if not exists idx_rollup1h_dims_gin on metric_rollup_1h using gin(dimensions);
