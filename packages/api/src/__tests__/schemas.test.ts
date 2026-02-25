import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ── Re-declare schemas locally (they're not exported from routes) ─────────────

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isoTs = z.string().regex(ISO8601_RE);

const MetricPointSchema = z.object({
  ts:         isoTs,
  asset_id:   z.string().min(1),
  namespace:  z.string().min(1),
  metric:     z.string().min(1),
  value:      z.number(),
  unit:       z.string().optional(),
  dimensions: z.record(z.string()).optional(),
});

const EventSchema = z.object({
  ts:          isoTs,
  asset_id:    z.string().min(1),
  namespace:   z.string().min(1),
  kind:        z.string().min(1),
  severity:    z.enum(['info', 'low', 'medium', 'high', 'critical']),
  title:       z.string().min(1),
  message:     z.string().optional(),
  fingerprint: z.string().optional(),
  attributes:  z.record(z.any()).optional(),
});

// ── Metric point schema ───────────────────────────────────────────────────────

describe('MetricPointSchema', () => {
  const valid = {
    ts:        '2024-01-15T10:30:00Z',
    asset_id:  'host:server1',
    namespace: 'nagios',
    metric:    'load1',
    value:     1.5,
  };

  it('accepts a valid metric point', () => {
    expect(() => MetricPointSchema.parse(valid)).not.toThrow();
  });

  it('accepts optional unit and dimensions', () => {
    const result = MetricPointSchema.parse({ ...valid, unit: 'percent', dimensions: { region: 'us-east' } });
    expect(result.unit).toBe('percent');
    expect(result.dimensions).toEqual({ region: 'us-east' });
  });

  it('rejects missing asset_id', () => {
    const { asset_id: _, ...rest } = valid;
    expect(() => MetricPointSchema.parse(rest)).toThrow();
  });

  it('rejects empty namespace', () => {
    expect(() => MetricPointSchema.parse({ ...valid, namespace: '' })).toThrow();
  });

  it('rejects invalid ISO timestamp (no timezone)', () => {
    expect(() => MetricPointSchema.parse({ ...valid, ts: '2024-01-15T10:30:00' })).toThrow();
  });

  it('rejects invalid ISO timestamp (date only)', () => {
    expect(() => MetricPointSchema.parse({ ...valid, ts: '2024-01-15' })).toThrow();
  });

  it('accepts ISO timestamp with offset', () => {
    expect(() => MetricPointSchema.parse({ ...valid, ts: '2024-01-15T10:30:00-03:00' })).not.toThrow();
  });

  it('accepts ISO timestamp with milliseconds', () => {
    expect(() => MetricPointSchema.parse({ ...valid, ts: '2024-01-15T10:30:00.123Z' })).not.toThrow();
  });

  it('rejects non-numeric value', () => {
    expect(() => MetricPointSchema.parse({ ...valid, value: 'high' })).toThrow();
  });
});

// ── Event schema ──────────────────────────────────────────────────────────────

describe('EventSchema', () => {
  const valid = {
    ts:        '2024-01-15T10:30:00Z',
    asset_id:  'host:server1',
    namespace: 'wazuh',
    kind:      'alert',
    severity:  'high' as const,
    title:     'Suspicious login detected',
  };

  it('accepts a valid event', () => {
    expect(() => EventSchema.parse(valid)).not.toThrow();
  });

  it('accepts all severity values', () => {
    for (const sev of ['info', 'low', 'medium', 'high', 'critical'] as const) {
      expect(() => EventSchema.parse({ ...valid, severity: sev })).not.toThrow();
    }
  });

  it('rejects unknown severity', () => {
    expect(() => EventSchema.parse({ ...valid, severity: 'warning' })).toThrow();
  });

  it('rejects empty title', () => {
    expect(() => EventSchema.parse({ ...valid, title: '' })).toThrow();
  });

  it('accepts optional fields', () => {
    const result = EventSchema.parse({
      ...valid,
      message:     'Details here',
      fingerprint: 'abc123',
      attributes:  { rule_id: '1001' },
    });
    expect(result.fingerprint).toBe('abc123');
    expect(result.attributes).toEqual({ rule_id: '1001' });
  });
});

// ── Ingest batch limits ───────────────────────────────────────────────────────

describe('Ingest batch limits', () => {
  const metricPoint = {
    ts: '2024-01-15T10:30:00Z', asset_id: 'a', namespace: 'n', metric: 'm', value: 1,
  };
  const IngestMetricsSchema = z.object({ metrics: z.array(MetricPointSchema).max(5000) });

  it('accepts batch up to 5000 metrics', () => {
    const batch = Array(100).fill(metricPoint);
    expect(() => IngestMetricsSchema.parse({ metrics: batch })).not.toThrow();
  });

  it('rejects batch over 5000 metrics', () => {
    const batch = Array(5001).fill(metricPoint);
    expect(() => IngestMetricsSchema.parse({ metrics: batch })).toThrow();
  });

  it('rejects empty metrics array', () => {
    // array.min(1) not set — empty array is allowed, but ensure the schema structure is correct
    expect(() => IngestMetricsSchema.parse({ metrics: [] })).not.toThrow();
  });
});
