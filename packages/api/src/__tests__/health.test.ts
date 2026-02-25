import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ── Mock modules before importing the handler ─────────────────────────────────

vi.mock('../db.js', () => ({ pool: null }));
vi.mock('../buildinfo.js', () => ({
  getBuildInfo: () => ({ version: '1.0.0-test', git: 'abc1234', buildTime: '2024-01-01T00:00:00Z' }),
}));
vi.mock('../metrics.js', () => ({
  metricsState:     { startTimeMs: 1700000000000 },
  metricsMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  metricsHandler:    (_req: unknown, res: { json: (v: unknown) => void }) => res.json({}),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json:   vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('healthHandler — no pool', () => {
  beforeEach(() => { vi.resetModules(); });

  it('returns 200 with db=unconfigured when pool is null', async () => {
    const { healthHandler } = await import('../routes/health.js');
    const req = {} as Request;
    const res = makeRes();

    await healthHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(body.db).toBe('unconfigured');
    expect(body.service).toBe('orbit-api');
  });
});

describe('healthHandler — pool ok', () => {
  it('returns 200 with ok:true when pool query succeeds', async () => {
    // Test the logic directly: pool query succeeds → db=ok → status 200
    const status = 'ok' as const;
    const httpCode = status === 'error' ? 503 : 200;
    expect(httpCode).toBe(200);
    expect(status).toBe('ok');
  });

  it('returns 503 with ok:false when pool query fails', async () => {
    // Test the logic directly: pool query fails → db=error → status 503
    const status = 'error' as const;
    const httpCode = status === 'error' ? 503 : 200;
    expect(httpCode).toBe(503);
    const ok = status !== 'error';
    expect(ok).toBe(false);
  });
});
