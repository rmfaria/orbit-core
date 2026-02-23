-- Composite index for the most common events query pattern: filter by namespace, order/range by ts.
create index concurrently if not exists idx_orbit_events_namespace_ts
  on orbit_events (namespace, ts desc);

-- Separate index for asset_id-scoped event lookups.
create index concurrently if not exists idx_orbit_events_asset_ts
  on orbit_events (asset_id, ts desc);
