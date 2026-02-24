-- Replace MVP relational dashboards/widgets with spec-based JSONB storage.
-- The old tables were created in 0002 but never used by any route.

drop table if exists widgets;
drop table if exists dashboards;

create table if not exists dashboards (
  id          text        primary key,
  spec        jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_dashboards_updated on dashboards(updated_at desc);
