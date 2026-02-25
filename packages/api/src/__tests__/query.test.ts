import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ── Re-declare query schemas (they're not exported from routes) ───────────────

const TimeseriesQuerySchema = z.object({
  kind:       z.literal('timeseries'),
  asset_id:   z.string().min(1),
  namespace:  z.string().min(1),
  metric:     z.string().min(1),
  from:       z.string().min(1),
  to:         z.string().min(1),
  bucket_sec: z.number().int().positive().max(86400).optional(),
  agg:        z.enum(['avg', 'min', 'max', 'sum']).optional(),
  limit:      z.number().int().positive().max(200000).optional(),
});

const TimeseriesMultiQuerySchema = z.object({
  kind:   z.literal('timeseries_multi'),
  from:   z.string().min(1),
  to:     z.string().min(1),
  series: z.array(z.object({
    asset_id:  z.string().min(1),
    namespace: z.string().min(1),
    metric:    z.string().min(1),
    label:     z.string().min(1).optional(),
  })).min(1).max(50),
  limit: z.number().int().positive().max(200000).optional(),
});

const EventsQuerySchema = z.object({
  kind:       z.literal('events'),
  from:       z.string().min(1),
  to:         z.string().min(1),
  namespace:  z.string().min(1).optional(),
  severities: z.array(z.enum(['info', 'low', 'medium', 'high', 'critical'])).optional(),
  limit:      z.number().int().positive().max(10000).optional(),
});

const OrbitQlQuerySchema = z.discriminatedUnion('kind', [
  TimeseriesQuerySchema,
  TimeseriesMultiQuerySchema,
  EventsQuerySchema,
]);

// ── Timeseries ────────────────────────────────────────────────────────────────

describe('TimeseriesQuerySchema', () => {
  const valid = {
    kind: 'timeseries' as const,
    asset_id: 'host:server1',
    namespace: 'nagios',
    metric: 'load1',
    from: '2024-01-14T00:00:00Z',
    to:   '2024-01-15T00:00:00Z',
  };

  it('accepts a valid timeseries query', () => {
    expect(() => TimeseriesQuerySchema.parse(valid)).not.toThrow();
  });

  it('accepts optional agg and bucket_sec', () => {
    const r = TimeseriesQuerySchema.parse({ ...valid, agg: 'avg', bucket_sec: 300 });
    expect(r.agg).toBe('avg');
    expect(r.bucket_sec).toBe(300);
  });

  it('rejects agg value not in enum', () => {
    expect(() => TimeseriesQuerySchema.parse({ ...valid, agg: 'median' })).toThrow();
  });

  it('rejects bucket_sec over 86400', () => {
    expect(() => TimeseriesQuerySchema.parse({ ...valid, bucket_sec: 86401 })).toThrow();
  });

  it('rejects limit over 200000', () => {
    expect(() => TimeseriesQuerySchema.parse({ ...valid, limit: 200001 })).toThrow();
  });
});

// ── Timeseries multi ──────────────────────────────────────────────────────────

describe('TimeseriesMultiQuerySchema', () => {
  const valid = {
    kind: 'timeseries_multi' as const,
    from: '2024-01-14T00:00:00Z',
    to:   '2024-01-15T00:00:00Z',
    series: [
      { asset_id: 'host:s1', namespace: 'nagios', metric: 'load1' },
      { asset_id: 'host:s2', namespace: 'nagios', metric: 'load1' },
    ],
  };

  it('accepts valid multi query', () => {
    expect(() => TimeseriesMultiQuerySchema.parse(valid)).not.toThrow();
  });

  it('rejects empty series array', () => {
    expect(() => TimeseriesMultiQuerySchema.parse({ ...valid, series: [] })).toThrow();
  });

  it('rejects series over 50', () => {
    const series = Array(51).fill({ asset_id: 'a', namespace: 'n', metric: 'm' });
    expect(() => TimeseriesMultiQuerySchema.parse({ ...valid, series })).toThrow();
  });
});

// ── Discriminated union ───────────────────────────────────────────────────────

describe('OrbitQlQuerySchema discriminated union', () => {
  it('routes to timeseries branch by kind', () => {
    const q = OrbitQlQuerySchema.parse({
      kind: 'timeseries', asset_id: 'a', namespace: 'n', metric: 'm',
      from: '2024-01-01T00:00:00Z', to: '2024-01-02T00:00:00Z',
    });
    expect(q.kind).toBe('timeseries');
  });

  it('routes to events branch by kind', () => {
    const q = OrbitQlQuerySchema.parse({
      kind: 'events', from: '2024-01-01T00:00:00Z', to: '2024-01-02T00:00:00Z',
    });
    expect(q.kind).toBe('events');
  });

  it('rejects unknown kind', () => {
    expect(() => OrbitQlQuerySchema.parse({
      kind: 'unknown', from: '2024-01-01T00:00:00Z', to: '2024-01-02T00:00:00Z',
    })).toThrow();
  });

  it('rejects missing required fields for timeseries', () => {
    expect(() => OrbitQlQuerySchema.parse({
      kind: 'timeseries', from: '2024-01-01T00:00:00Z', to: '2024-01-02T00:00:00Z',
      // missing asset_id, namespace, metric
    })).toThrow();
  });
});
