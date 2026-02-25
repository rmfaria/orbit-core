import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dashboardsRouter } from '../routes/dashboards.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp(pool: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', dashboardsRouter(pool as any));
  // Error handler so validation errors return 400 instead of crashing
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err?.name === 'ZodError' || err?.issues) {
      return res.status(400).json({ ok: false, error: 'validation error' });
    }
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  });
  return app;
}

const minimalWidget = {
  id: 'w1', title: 'Test Widget', kind: 'kpi',
  layout: { x: 0, y: 0, w: 1, h: 1 },
  query: { kind: 'timeseries', asset_id: 'a', namespace: 'n', metric: 'm', from: '2024-01-01T00:00:00Z', to: '2024-01-02T00:00:00Z' },
};

const minimalSpec = {
  id:      'dash-test-001',
  name:    'Test Dashboard',
  version: 'v1',
  time:    { preset: '24h' },
  tags:    [],
  widgets: [minimalWidget],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboards — list', () => {
  it('returns empty list when no dashboards', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }), on: vi.fn() };
    const app = makeApp(mockPool);

    const res = await (request(app) as any).get('/api/v1/dashboards');
    expect(res.status).toBe(200);
    expect(res.body.dashboards).toEqual([]);
  });

  it('returns list of dashboards from DB', async () => {
    const rows = [{
      id: 'dash-1', name: 'My Dash', description: null,
      time: { preset: '24h' }, widget_count: 2, updated_at: '2024-01-01T00:00:00Z',
    }];
    const mockPool = { query: vi.fn().mockResolvedValue({ rows }), on: vi.fn() };
    const app = makeApp(mockPool);

    const res = await (request(app) as any).get('/api/v1/dashboards');
    expect(res.status).toBe(200);
    expect(res.body.dashboards).toHaveLength(1);
    expect(res.body.dashboards[0].id).toBe('dash-1');
  });

  it('returns empty list when pool is null (graceful degradation)', async () => {
    const app = makeApp(null);
    const res = await (request(app) as any).get('/api/v1/dashboards');
    expect(res.status).toBe(200);
    expect(res.body.dashboards).toEqual([]);
  });
});

describe('GET /api/v1/dashboards/:id', () => {
  it('returns 404 when dashboard not found', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }), on: vi.fn() };
    const app = makeApp(mockPool);

    const res = await (request(app) as any).get('/api/v1/dashboards/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns dashboard spec when found', async () => {
    const rows = [{ spec: minimalSpec, created_at: '2024-01-01', updated_at: '2024-01-01' }];
    const mockPool = { query: vi.fn().mockResolvedValue({ rows }), on: vi.fn() };
    const app = makeApp(mockPool);

    const res = await (request(app) as any).get('/api/v1/dashboards/dash-test-001');
    expect(res.status).toBe(200);
    // spec is nested: { ok, spec: { id, name, ... }, created_at, updated_at }
    expect(res.body.spec.id).toBe('dash-test-001');
  });
});

describe('POST /api/v1/dashboards — create', () => {
  it('returns 400 for invalid spec (missing name)', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }), on: vi.fn() };
    const app = makeApp(mockPool);

    const res = await (request(app) as any)
      .post('/api/v1/dashboards')
      .send({ id: 'x', version: 'v1', time: { preset: '24h' }, tags: [], widgets: [] });
    expect(res.status).toBe(400);
  });

  it('saves a valid dashboard and returns ok:true', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }), on: vi.fn() };
    const app = makeApp(mockPool);

    const res = await (request(app) as any)
      .post('/api/v1/dashboards')
      .send(minimalSpec);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(mockPool.query).toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/dashboards/:id', () => {
  it('returns 404 when dashboard does not exist', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: vi.fn() };
    const app = makeApp(mockPool);

    const res = await (request(app) as any).delete('/api/v1/dashboards/ghost');
    expect(res.status).toBe(404);
  });

  it('deletes dashboard and returns ok:true', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'dash-1' }], rowCount: 1 }),
      on:    vi.fn(),
    };
    const app = makeApp(mockPool);

    const res = await (request(app) as any).delete('/api/v1/dashboards/dash-1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
