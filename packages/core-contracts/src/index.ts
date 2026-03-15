export type OrbitErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type Asset = {
  asset_id: string;
  type: 'host' | 'service' | 'app' | 'network' | 'custom';
  name: string;
  labels?: Record<string, string>;
  tags?: string[];
  criticality?: 'low' | 'medium' | 'high' | 'critical';
  enabled?: boolean;
  first_seen?: string;
  last_seen?: string;
};

export type MetricPoint = {
  ts: string;
  asset_id: string;
  namespace: string;
  metric: string;
  value: number;
  unit?: string;
  dimensions?: Record<string, string>;
};

export type Event = {
  ts: string;
  asset_id: string;
  namespace: string;
  kind: string;
  severity: Severity;
  title: string;
  message?: string;
  fingerprint?: string;
  attributes?: Record<string, any>;
};

export type ThreatIndicator = {
  source: string;
  source_id: string;
  type: string;
  value: string;
  threat_level: 'high' | 'medium' | 'low' | 'undefined' | 'unknown';
  tags?: string[];
  event_info?: string;
  comment?: string;
  attributes?: Record<string, any>;
  first_seen?: string;
  last_seen?: string;
  expires_at?: string;
  enabled?: boolean;
};

export type IngestIndicatorsRequest = {
  indicators: ThreatIndicator[];
};

export type IngestMetricsRequest = {
  metrics: MetricPoint[];
};

export type IngestEventsRequest = {
  events: Event[];
};

export interface ApiError {
  code: OrbitErrorCode;
  message: string;
  details?: unknown;
}

export interface HealthResponse {
  ok: true;
  service: 'orbit-api';
  version: string;
  time: string; // ISO
}

/**
 * MVP query contract.
 * Later: add query compilation, saved searches, pagination, streaming.
 */
export type QueryLanguage = 'sql' | 'orbitql';

export type TimeseriesQuery = {
  kind: 'timeseries';
  asset_id: string;
  namespace: string;
  metric: string;
  from: string; // ISO
  to: string; // ISO
  /** When set, downsample by bucket. */
  bucket_sec?: number;
  /** Aggregate function (used when bucket_sec is set). */
  agg?: 'avg' | 'min' | 'max' | 'sum';
  /** Optional dimensions exact-match filter. */
  dimensions?: Record<string, string>;
  limit?: number;
};

export type TimeseriesMultiQuery = {
  kind: 'timeseries_multi';
  from: string; // ISO
  to: string; // ISO
  bucket_sec?: number;
  agg?: 'avg' | 'min' | 'max' | 'sum';
  /** If set, split series by a dimension key (e.g., "service"). */
  group_by_dimension?: string;
  /** Limit cardinality of group_by_dimension (default 20 when group_by_dimension is set). */
  top_n?: number;
  /** Ranking method for top-n. Default: count. */
  top_by?: 'count' | 'last';
  /** Lookback window for ranking (days). Default: 7. */
  top_lookback_days?: number;
  series: Array<{
    asset_id: string;
    namespace: string;
    metric: string;
    /** label shown in results (optional) */
    label?: string;
    dimensions?: Record<string, string>;
  }>;
  limit?: number;
};

export type EventsQuery = {
  kind: 'events';
  asset_id?: string;
  namespace?: string;
  from: string;
  to: string;
  severities?: Severity[];
  kinds?: string[];
  limit?: number;
};

export type EventCountQuery = {
  kind: 'event_count';
  namespace?: string;
  asset_id?: string;
  severities?: Severity[];
  from: string;
  to: string;
  bucket_sec?: number;
};

export type OrbitQlQuery = TimeseriesQuery | TimeseriesMultiQuery | EventsQuery | EventCountQuery;

export interface QueryRequest {
  language: QueryLanguage;
  /** For sql: query string. For orbitql: structured query. */
  query: string | OrbitQlQuery;
  /** Back-compat fields (optional). */
  from?: string;
  to?: string;
  filters?: Record<string, string | number | boolean>;
  limit?: number;
}

export interface QueryResult {
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
}

export interface QueryResponse {
  ok: true;
  result: QueryResult;
  meta?: {
    effective_bucket_sec?: number;
    effective_limit?: number;
    mode?: 'raw' | 'bucketed';
    source_table?: 'metric_points' | 'metric_rollup_5m' | 'metric_rollup_1h';
    truncated?: boolean;
  };
}

// Dashboard specs (for builders)
export * from './dashboard.js';
