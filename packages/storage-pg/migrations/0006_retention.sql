-- Retention helper function called by the rollup worker (not a cron job —
-- avoids pg_cron dependency). The worker calls this once per day.
--
-- Retention windows (env-overridable at app level, hardcoded here as defaults):
--   metric_points   : 14 days
--   metric_rollup_5m: 90 days
--   metric_rollup_1h: 180 days
--   orbit_events    : 180 days

create or replace function purge_old_data(
  p_metric_raw_days    int default 14,
  p_rollup_5m_days     int default 90,
  p_rollup_1h_days     int default 180,
  p_events_days        int default 180
) returns table (
  table_name text,
  rows_deleted bigint
) language plpgsql as $$
declare
  v_deleted bigint;
begin
  delete from metric_points
    where ts < now() - (p_metric_raw_days || ' days')::interval;
  get diagnostics v_deleted = row_count;
  return query select 'metric_points'::text, v_deleted;

  delete from metric_rollup_5m
    where bucket_ts < now() - (p_rollup_5m_days || ' days')::interval;
  get diagnostics v_deleted = row_count;
  return query select 'metric_rollup_5m'::text, v_deleted;

  delete from metric_rollup_1h
    where bucket_ts < now() - (p_rollup_1h_days || ' days')::interval;
  get diagnostics v_deleted = row_count;
  return query select 'metric_rollup_1h'::text, v_deleted;

  delete from orbit_events
    where ts < now() - (p_events_days || ' days')::interval;
  get diagnostics v_deleted = row_count;
  return query select 'orbit_events'::text, v_deleted;
end;
$$;
